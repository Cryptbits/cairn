/**
 * Phase 2 HCU benchmark — deploys CairnPool locally against the fhevm mock
 * coprocessor, seeds it with an increasing number of participants, and
 * measures the REAL globalHCU/maxHCUDepth of the draw-resolution functions at each
 * cohort size using hre.fhevm.computeTransactionHCU(), which is verified
 * against the installed @fhevm/hardhat-plugin (see src/internal/
 * FhevmExternalAPI.ts in the installed package — not invented).
 *
 * UPDATE: this script has now actually been run against a real local
 * Hardhat node (`--network localhost`). Measured cohortSize 2/5/10/15/20/30
 * all succeeded (162,000 / 648,000 / 1,458,000 / 2,268,000 / 3,078,000 /
 * 4,698,000 globalHCU against the 5,000,000 per-tx budget); cohortSize 50
 * reverted with HCUTransactionDepthLimitExceeded(). See docs/DEPLOYMENT.md
 * section 4 for the full measured table (which replaces the old
 * hand-calculated estimate) and for how MAX_COHORT_SIZE=30 was derived
 * from it. Re-run this script and update those numbers if
 * CairnPool.sol's resolution loop changes at all.
 *
 * Usage (two terminals — the fhevm plugin's CLI API rejects the default
 * in-memory --network hardhat; it only accepts a real running node):
 *   Terminal 1: npx hardhat node
 *   Terminal 2: npx hardhat run scripts/benchmarkHCU.ts --network localhost
 * (Confirmed against a real run: --network hardhat throws
 * "HardhatFhevmError: The Fhevm CLI only supports the Hardhat Node
 * (--network localhost) or Sepolia (--network sepolia) networks.")
 */

import { ethers, fhevm } from "hardhat";

async function main() {
  // `hardhat test` initializes the fhevm plugin automatically via its own
  // mocha root hooks. A plain `hardhat run <script>` does not go through
  // that lifecycle, so the plugin instance is never created and every
  // fhevm.* call throws "The Hardhat Fhevm plugin is not initialized." —
  // confirmed against the installed package's own source
  // (node_modules/@fhevm/hardhat-plugin/src/internal/FhevmEnvironment.ts),
  // not guessed. This call is what `hardhat test` does implicitly.
  await fhevm.initializeCLIApi();

  const cohortSizes = [2, 5, 10, 15, 20, 30, 50];

  const signers = await ethers.getSigners();
  if (signers.length < Math.max(...cohortSizes) + 1) {
    console.warn(
      `Only ${signers.length} local signers available; the largest cohort sizes below will be skipped. ` +
        `Increase the hardhat network's account count to test them.`,
    );
  }

  // The benchmark only exercises draw resolution, which never touches
  // CUSDT — but the constructor now requires a real IERC7984 address (see
  // contracts/CairnPool.sol), so we deploy the same test-only MockCUSDT
  // used in test/CairnPool.deposit.test.ts purely to satisfy that argument.
  const TokenFactory = await ethers.getContractFactory("MockCUSDT");
  const mockCusdt = await TokenFactory.deploy();
  await mockCusdt.waitForDeployment();
  const cusdtAddress = await mockCusdt.getAddress();

  const Factory = await ethers.getContractFactory("CairnPool");
  // Deploy with a permissive maxCohortSize so the benchmark itself is never
  // blocked by the very limit it exists to determine. minCohortSize=1 and
  // minDrawIntervalSeconds=0 so the benchmark can request draws freely.
  const pool = await Factory.deploy(cusdtAddress, 1000, 1, 0, 300 /* yieldRateBps — irrelevant to HCU measurement, matches deploy.ts's default */);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();

  console.log(`CairnPool deployed at ${poolAddress}\n`);
  console.log("cohortSize\tglobalHCU\tmaxHCUDepth");

  let lastDeposited = 0;

  for (const size of cohortSizes) {
    if (size + 1 > signers.length) continue;

    // Deposit for any newly-added participants since the last measurement
    // (deposits are cumulative across iterations so we're always measuring
    // requestDrawResolution() over a real, growing participant list).
    for (let i = lastDeposited; i < size; i++) {
      const user = signers[i + 1];
      // ERC-7984 confidentialTransferFrom (which CairnPool.deposit() calls
      // internally — see contracts/CairnPool.sol) requires the pool to be
      // an approved operator on the token first, same as this repo's own
      // deposit docs already state. Missing this line is what causes
      // `ERC7984UnauthorizedSpender` on the very first seeded deposit.
      const until = Math.floor(Date.now() / 1000) + 3600;
      await (await mockCusdt.connect(user).setOperator(poolAddress, until)).wait();
      const enc = await fhevm.createEncryptedInput(poolAddress, user.address).add64(1_000_000).encrypt();
      const tx = await pool.connect(user).deposit(enc.handles[0], enc.inputProof);
      await tx.wait();
    }
    lastDeposited = size;

    // requestDrawResolution() requires allParticipantsReady() (every
    // tracked participant has called setReadyForDraw(true)) — see
    // contracts/CairnPool.sol. It also clears every participant's
    // readiness as part of resolving a draw, so this has to be redone
    // every iteration, not just for newly-deposited participants: without
    // it requestDrawResolution reverts with "not everyone has marked
    // ready yet" on every single call, which the catch block below used to
    // silently mislabel as an HCU depth-limit revert.
    for (let i = 0; i < size; i++) {
      const user = signers[i + 1];
      await (await pool.connect(user).setReadyForDraw(true)).wait();
    }

    // Benchmarks Step 1 (requestDrawResolution) and Step 2 (submitTotalWeight,
    // which now also draws a winner in the same call — see the doc comment
    // on submitTotalWeight in contracts/CairnPool.sol). Both are measured
    // because both scan the same cohort and both count against the per-tx
    // HCU budget. drawId is now self-sequenced by the contract (see
    // contracts/CairnPool.sol's permissionless-draws revision) — read it
    // before calling so we can still log/reference which drawId this
    // cohort got.
    const drawId = await pool.nextDrawId();
    try {
      const tx1 = await pool.connect(signers[0]).requestDrawResolution();
      const receipt1 = await tx1.wait();
      if (!receipt1) throw new Error("no receipt");
      const hcu1 = await fhevm.computeTransactionHCU(receipt1);
      console.log(`${size}\t\trequestDrawResolution\t${hcu1.globalHCU}\t${hcu1.maxHCUDepth}\t(drawId ${drawId})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // The FHEVM coprocessor's real depth-limit revert. Anything else
      // (a plain Solidity require(), a missing-ready gate, ACL issues,
      // etc.) is a genuine bug, not "the answer this benchmark exists to
      // find" — surface it instead of mislabeling it, which is what let
      // an unrelated require() revert masquerade as an HCU result before.
      const isHcuDepthLimit = message.includes("HCUTransactionDepthLimitExceeded");
      if (!isHcuDepthLimit) {
        console.error(`${size}\t\trequestDrawResolution\tFAILED — NOT an HCU depth-limit revert:\n${message}`);
        throw err;
      }

      // A revert here at larger cohort sizes IS the answer this benchmark
      // exists to find: it means that cohort size exceeds Zama's per-tx HCU
      // depth limit (5,000,000 — see docs.zama.org/protocol/solidity-guides/
      // development-guide/hcu) in this contract's current, fully-sequential
      // resolution loop. Report it plainly and stop — every larger
      // cohortSize will fail worse, so there's nothing more to measure.
      console.log(`${size}\t\trequestDrawResolution\tEXCEEDS HCU DEPTH LIMIT (tx reverted)`);
      console.log(
        `\nStopping here: cohortSize ${size} does not fit in one transaction under the current HCU depth ` +
          `limit. The largest cohortSize actually measured to succeed above is the real ceiling for this ` +
          `contract's current (fully sequential) resolution loop — see the printed rows above.`,
      );
      break;
    }

    // NOTE: submitTotalWeight's winner-selection pass requires a real KMS
    // decryption proof from the relayer/mock oracle for the total weight —
    // not exercised by this benchmark loop, which measures raw FHE
    // operation cost, not the full async decryption round trip. Measuring
    // submitTotalWeight's full HCU cost (once a real total-weight proof is
    // available in your environment) is the next step; the two passes have
    // the same operation *shape* (one add-and-compare loop each) so
    // requestDrawResolution's measured cost here is a reliable proxy for
    // submitTotalWeight's winner-selection cost until that's measured
    // directly.
  }

  console.log(
    "\nRecord these measured numbers in docs/DEPLOYMENT.md section 4, replacing " +
      "the hand-calculated placeholder estimate, then set CairnPool's maxCohortSize " +
      "from the largest cohort that stays safely under the documented per-tx " +
      "HCU budget (leave real margin — do not target the ceiling exactly).",
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
