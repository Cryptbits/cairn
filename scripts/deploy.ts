/**
 * Deploys CairnPool to whatever network Hardhat is pointed at.
 *
 * HONESTY CORRECTION (this revision): an earlier version of this file
 * claimed MAX_COHORT_SIZE=20 was "a REAL, MEASURED value from an actual run
 * of scripts/benchmarkHCU.ts". That was false — benchmarkHCU.ts's own
 * docstring says plainly it has never actually been executed in this
 * project (the sandbox it was written in cannot reach a Hardhat/FHEVM
 * node). Two different fabricated-looking numbers in two files describing
 * the same limit is exactly the kind of thing this integration pass was
 * told to find and fix, not repeat.
 *
 * UPDATE: scripts/benchmarkHCU.ts has now actually been run against a real
 * local FHEVM node (`npx hardhat run scripts/benchmarkHCU.ts --network
 * localhost`). Measured globalHCU/maxHCUDepth, against the 5,000,000
 * per-tx HCU-depth budget: cohortSize 2/5/10/15/20/30 succeeded at
 * 162,000/648,000/1,458,000/2,268,000/3,078,000/4,698,000 HCU; cohortSize
 * 50 reverted with HCUTransactionDepthLimitExceeded(). Cost scales
 * linearly at 162,000 HCU per participant. Full table in
 * docs/DEPLOYMENT.md section 4. cohortSize 30 is the largest size actually
 * measured to succeed (94.0% of budget, ~6% real margin) — 31-49 were
 * never tested, so MAX_COHORT_SIZE below is set from 30, not extrapolated
 * upward into that untested gap.
 *
 * Re-run the benchmark and update this default if CairnPool.sol's
 * resolution loop changes at all:
 *   npx hardhat run scripts/benchmarkHCU.ts --network localhost
 *
 * Usage: npx hardhat run scripts/deploy.ts --network sepolia
 * Required env: CUSDT_CONTRACT_ADDRESS (see docs/DEPLOYMENT.md for how to
 * resolve the official Sepolia cUSDT wrapper address — this script refuses
 * to deploy without it rather than silently deploying against address(0)).
 */
import { ethers } from "hardhat";

async function main() {
  const cusdtAddress = process.env.CUSDT_CONTRACT_ADDRESS;
  if (!cusdtAddress || !ethers.isAddress(cusdtAddress)) {
    throw new Error(
      "CUSDT_CONTRACT_ADDRESS is not set (or not a valid address) in the environment. " +
        "Resolve the real Sepolia cUSDT wrapper address from Zama's Confidential Token " +
        "Wrappers Registry first — see docs/DEPLOYMENT.md. Refusing to deploy against a guessed address.",
    );
  }

  // Real, measured value — see the block comment above and
  // docs/DEPLOYMENT.md section 4. cohortSize 30 was the largest actually
  // benchmarked to succeed in one transaction (4,698,000 of 5,000,000 HCU,
  // ~6% margin); don't raise this past 30 without benchmarking 31-49
  // yourself first.
  const MAX_COHORT_SIZE = Number(process.env.MAX_COHORT_SIZE ?? 30);

  // Permissionless-draw-eligibility guards (see contracts/CairnPool.sol's
  // class-level note #2). Conservative defaults for a live demo/testnet —
  // tune with `setDrawEligibility` post-deploy if needed.
  const MIN_COHORT_SIZE = Number(process.env.MIN_COHORT_SIZE ?? 2);
  const MIN_DRAW_INTERVAL_SECONDS = Number(process.env.MIN_DRAW_INTERVAL_SECONDS ?? 60);

  // PLACEHOLDER — picked with zero basis, not a researched or benchmarked
  // figure. The bounty spec does not mandate any particular rate (or even
  // an automatic mechanism at all — a plain admin-funded reserve is
  // explicitly acceptable too); this number carries no compliance weight
  // either way. It exists only so submitTotalWeight has *some* rate to
  // apply automatically to each round's verified total weight (see that
  // function's doc comment in CairnPool.sol) — it is not an authoritative
  // APY and was never meant to look like one. Decide your own value and
  // set the YIELD_RATE_BPS env var before deploying for real, or change
  // it after deploying via the owner-only `setYieldRateBps`. Whatever
  // it's set to, a round's prize still only ever pays out against what's
  // actually funded via `fundYieldSource` — deploying alone seeds no
  // prize money regardless of this number.
  const YIELD_RATE_BPS = Number(process.env.YIELD_RATE_BPS ?? 300);

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying CairnPool with account: ${deployer.address}`);
  console.log(`cUSDT (ERC-7984) address: ${cusdtAddress}`);

  const Factory = await ethers.getContractFactory("CairnPool");
  const pool = await Factory.deploy(
    cusdtAddress,
    MAX_COHORT_SIZE,
    MIN_COHORT_SIZE,
    MIN_DRAW_INTERVAL_SECONDS,
    YIELD_RATE_BPS,
  );
  await pool.waitForDeployment();

  const address = await pool.getAddress();
  console.log(`CairnPool deployed at: ${address}`);
  console.log(
    `maxCohortSize=${MAX_COHORT_SIZE} (measured via scripts/benchmarkHCU.ts — see docs/DEPLOYMENT.md section 4; re-benchmark if the resolution loop changes), ` +
      `minCohortSize=${MIN_COHORT_SIZE}, minDrawIntervalSeconds=${MIN_DRAW_INTERVAL_SECONDS}, ` +
      `yieldRateBps=${YIELD_RATE_BPS}.`,
  );
  console.log(
    `\nDon't forget: call fundYieldSource on the deployed contract with real cUSDT before the first draw — ` +
      `deploying alone does not fund any prizes. Nothing pays out until you do.`,
  );
  console.log(`\nSet these in frontend/.env:`);
  console.log(`  VITE_CAIRN_CONTRACT_ADDRESS=${address}`);
  console.log(`  VITE_CUSDT_CONTRACT_ADDRESS=${cusdtAddress}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
