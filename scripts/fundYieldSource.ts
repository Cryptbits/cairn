/**
 * Funds a deployed CairnPool's yield source with real cUSDT — the
 * owner-only step that seeds what `submitTotalWeight` automatically draws
 * each round's prize from (see that function's doc comment in
 * contracts/CairnPool.sol). Deploying a pool does NOT do this for you;
 * skip this and every draw resolves with a real, verifiable — but
 * silently $0 — prize.
 *
 * Must be run by the same account that deployed the pool (or whichever
 * account currently holds `owner()`), and that account must actually hold
 * the cUSDT being sent.
 *
 * Usage: npx hardhat run scripts/fundYieldSource.ts --network sepolia
 * Required env:
 *   CAIRN_CONTRACT_ADDRESS — the deployed pool (printed by scripts/deploy.ts)
 *   CUSDT_CONTRACT_ADDRESS — same cUSDT address the pool was deployed with
 *   YIELD_FUND_AMOUNT — how much cUSDT to add, in whole tokens (e.g. "50"
 *     for 50 cUSDT). Read at the token's real on-chain `decimals()` —
 *     never a hardcoded assumption.
 *
 * Uses the same `fhevm.createEncryptedInput(...)` call already verified
 * working in test/CairnPool.deposit.test.ts — the @fhevm/hardhat-plugin
 * documents this exact API working unmodified against `--network sepolia`
 * (see e.g. `npx hardhat fhevm user-decrypt --network sepolia` in the
 * plugin's own docs), not just the local mock network.
 */
import { ethers, fhevm } from "hardhat";

async function main() {
  const poolAddress = process.env.CAIRN_CONTRACT_ADDRESS;
  if (!poolAddress || !ethers.isAddress(poolAddress)) {
    throw new Error("CAIRN_CONTRACT_ADDRESS is not set (or not a valid address). This must be a pool already deployed via scripts/deploy.ts.");
  }
  const cusdtAddress = process.env.CUSDT_CONTRACT_ADDRESS;
  if (!cusdtAddress || !ethers.isAddress(cusdtAddress)) {
    throw new Error("CUSDT_CONTRACT_ADDRESS is not set (or not a valid address). Must match the address the pool was deployed with.");
  }
  const amountStr = process.env.YIELD_FUND_AMOUNT;
  if (!amountStr || Number.isNaN(Number(amountStr)) || Number(amountStr) <= 0) {
    throw new Error('YIELD_FUND_AMOUNT is not set (or not a positive number) — e.g. YIELD_FUND_AMOUNT="50" for 50 cUSDT.');
  }

  const [signer] = await ethers.getSigners();
  console.log(`Funding CairnPool ${poolAddress} from account: ${signer.address}`);

  const pool = await ethers.getContractAt("CairnPool", poolAddress);
  const owner = await pool.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`This account is not the pool owner. Pool owner is ${owner}, this account is ${signer.address}.`);
  }

  // Fully qualified name (not just "IERC7984") to guarantee this resolves
  // unambiguously regardless of what else in the dependency tree might
  // share the interface name.
  const cusdt = await ethers.getContractAt(
    "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol:IERC7984",
    cusdtAddress,
  );
  const decimals = await cusdt.decimals();
  const amountBaseUnits = ethers.parseUnits(amountStr, decimals);
  console.log(`Amount: ${amountStr} cUSDT = ${amountBaseUnits} base units (decimals=${decimals})`);

  // Same operator requirement as a normal deposit — fundYieldSource calls
  // confidentialTransferFrom exactly like deposit() does.
  const until = Math.floor(Date.now() / 1000) + 3600;
  console.log("Approving CairnPool as an operator on cUSDT...");
  await (await cusdt.setOperator(poolAddress, until)).wait();

  console.log("Encrypting the amount...");
  const enc = await fhevm.createEncryptedInput(poolAddress, signer.address).add64(amountBaseUnits).encrypt();

  console.log("Calling fundYieldSource...");
  const tx = await pool.fundYieldSource(enc.handles[0], enc.inputProof);
  const receipt = await tx.wait();
  console.log(`Done. fundYieldSource confirmed (${receipt?.hash}).`);
  console.log(
    `\nThis funded ${amountStr} cUSDT into the yield source. Each draw automatically pays out ` +
      `yieldRateBps of that round's verified total weight, clamped to what's left in the source — ` +
      `run this again to top it up whenever it's running low.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
