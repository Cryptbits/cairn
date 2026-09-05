/**
 * LOCAL-ONLY deploy: deploys the test-only MockCUSDT (contracts/test/MockCUSDT.sol)
 * plus CairnPool on top of it, then mints each account in MINT_TO some test
 * cUSDT so you can smoke-test the full app (deposit → ready → draw → claim
 * → withdraw) against a local Hardhat node without touching Sepolia or the
 * real cUSDT registry.
 *
 * scripts/deploy.ts is the real (Sepolia) deploy path and deliberately
 * refuses to run without a real CUSDT_CONTRACT_ADDRESS — this script is the
 * local counterpart that exists purely so you don't need one for local
 * testing.
 *
 * Usage (two terminals, same as scripts/benchmarkHCU.ts — the fhevm plugin
 * rejects the in-memory --network hardhat network):
 *   Terminal 1: npx hardhat node
 *   Terminal 2: npx hardhat run scripts/deployLocal.ts --network localhost
 *
 * Optional env:
 *   MINT_TO — comma-separated addresses to mint test cUSDT to, in addition
 *     to the deployer (e.g. an address imported into MetaMask from one of
 *     the private keys `npx hardhat node` prints on startup, so you can
 *     drive the frontend with it). Deployer is always minted regardless.
 *   MINT_AMOUNT — whole cUSDT per address (default 1000).
 *   MAX_COHORT_SIZE / MIN_COHORT_SIZE / MIN_DRAW_INTERVAL_SECONDS /
 *     YIELD_RATE_BPS — same meaning as scripts/deploy.ts; same defaults
 *     (30 / 2 / 60 / 300).
 */
import { ethers, fhevm } from "hardhat";

async function main() {
  await fhevm.initializeCLIApi();

  const [deployer, ...rest] = await ethers.getSigners();

  const extraMintTo = (process.env.MINT_TO ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  for (const addr of extraMintTo) {
    if (!ethers.isAddress(addr)) {
      throw new Error(`MINT_TO contains an invalid address: "${addr}"`);
    }
  }
  const mintAmountStr = process.env.MINT_AMOUNT ?? "1000";
  if (Number.isNaN(Number(mintAmountStr)) || Number(mintAmountStr) <= 0) {
    throw new Error(`MINT_AMOUNT must be a positive number, got "${mintAmountStr}".`);
  }

  const MAX_COHORT_SIZE = Number(process.env.MAX_COHORT_SIZE ?? 30);
  const MIN_COHORT_SIZE = Number(process.env.MIN_COHORT_SIZE ?? 2);
  const MIN_DRAW_INTERVAL_SECONDS = Number(process.env.MIN_DRAW_INTERVAL_SECONDS ?? 60);
  const YIELD_RATE_BPS = Number(process.env.YIELD_RATE_BPS ?? 300);

  console.log(`Deploying with account: ${deployer.address}`);

  console.log("\nDeploying MockCUSDT...");
  const TokenFactory = await ethers.getContractFactory("MockCUSDT");
  const cusdt = await TokenFactory.deploy();
  await cusdt.waitForDeployment();
  const cusdtAddress = await cusdt.getAddress();
  console.log(`MockCUSDT deployed at: ${cusdtAddress}`);

  console.log("\nDeploying CairnPool...");
  const PoolFactory = await ethers.getContractFactory("CairnPool");
  const pool = await PoolFactory.deploy(
    cusdtAddress,
    MAX_COHORT_SIZE,
    MIN_COHORT_SIZE,
    MIN_DRAW_INTERVAL_SECONDS,
    YIELD_RATE_BPS,
  );
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`CairnPool deployed at: ${poolAddress}`);
  console.log(
    `maxCohortSize=${MAX_COHORT_SIZE}, minCohortSize=${MIN_COHORT_SIZE}, ` +
      `minDrawIntervalSeconds=${MIN_DRAW_INTERVAL_SECONDS}, yieldRateBps=${YIELD_RATE_BPS}.`,
  );

  // Mint test cUSDT to the deployer plus anything in MINT_TO. Each mint is
  // a real encrypted-input call (mint(address, externalEuint64, bytes)),
  // same shape as scripts/fundYieldSource.ts's funding call.
  const mintTargets = [deployer.address, ...extraMintTo];
  const decimals = await cusdt.decimals();
  const amountBaseUnits = ethers.parseUnits(mintAmountStr, decimals);
  console.log(`\nMinting ${mintAmountStr} cUSDT (decimals=${decimals}) to ${mintTargets.length} address(es)...`);
  for (const to of mintTargets) {
    const enc = await fhevm.createEncryptedInput(cusdtAddress, deployer.address).add64(amountBaseUnits).encrypt();
    const tx = await cusdt.connect(deployer).mint(to, enc.handles[0], enc.inputProof);
    await tx.wait();
    console.log(`  minted to ${to}`);
  }

  console.log(
    "\nFunding the pool's yield source so draws pay out a non-zero prize " +
      `(${mintAmountStr} cUSDT, same amount as each mint above)...`,
  );
  const until = Math.floor(Date.now() / 1000) + 3600;
  await (await cusdt.connect(deployer).setOperator(poolAddress, until)).wait();
  const fundEnc = await fhevm.createEncryptedInput(poolAddress, deployer.address).add64(amountBaseUnits).encrypt();
  await (await pool.connect(deployer).fundYieldSource(fundEnc.handles[0], fundEnc.inputProof)).wait();
  console.log("Yield source funded.");

  console.log(`\nSet these in frontend/.env:`);
  console.log(`  VITE_CAIRN_CONTRACT_ADDRESS=${poolAddress}`);
  console.log(`  VITE_CUSDT_CONTRACT_ADDRESS=${cusdtAddress}`);
  console.log(
    "\nPoint MetaMask at a custom network: RPC http://127.0.0.1:8545, chainId 31337. " +
      "Import one of the private keys npx hardhat node printed on startup as your account " +
      "(that's " + deployer.address + " if you import the first one) — it already holds test " +
      "cUSDT and ETH for gas. To give a second wallet cUSDT too, re-run this script with " +
      "MINT_TO=<that address>.",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
