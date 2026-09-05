/**
 * Draw keeper — the "documented keeper/admin flow to trigger [draws]" the
 * bounty spec explicitly allows as an alternative to full on-chain
 * automation (Chainlink Automation etc.), and the fix for a real, reported
 * UX problem in the previous frontend-only design.
 *
 * PROBLEM THIS REPLACES:
 * `requestDrawResolution`/`submitTotalWeight`/`submitWinner` on
 * CairnPool.sol are, and remain, permissionless by design (see the
 * class-level doc comment on the contract — that's a deliberate
 * censorship-resistance property: the protocol keeps working even if
 * nobody ever runs this script). The bug was operational, not on-chain:
 * the frontend used to auto-fire these three calls from whichever
 * connected saver's browser happened to be open when a draw became
 * eligible. That means a random depositor's wallet — not the protocol,
 * not an operator — paid gas to advance a draw that benefits every saver
 * equally. Nobody signs up to fund a shared, protocol-level action out of
 * their own pocket, and "whoever has a tab open" is not a defensible
 * production design.
 *
 * THE FIX: this script is a dedicated keeper bot. It runs on its own
 * wallet (KEEPER_PRIVATE_KEY below — intentionally NOT the same key as
 * DEPLOYER_PRIVATE_KEY/pool owner, though it's allowed to be; the keeper
 * needs no special on-chain privilege at all, only Sepolia ETH for gas),
 * and it is the thing that actually calls requestDrawResolution /
 * submitTotalWeight / submitWinner once a draw is genuinely eligible or
 * mid-flight. Regular savers now only ever sign `setReadyForDraw` (their
 * own, personal, on-chain readiness signal) and — if they win —
 * `claimPrize`. No saver's wallet is ever prompted to advance a draw on
 * anyone else's behalf; see frontend/src/components/views/Draw.tsx, which
 * now only reads and displays draw progress instead of auto-firing these calls.
 *
 * The contract staying permissionless means this bot is a convenience, not
 * a trust assumption: if it's ever offline, the pool owner (or literally
 * anyone, via Etherscan's "Write Contract" tab) can still call the exact
 * same three functions by hand — see docs/DEPLOYMENT.md's "If the keeper
 * is down" section. That fallback is the "admin flow" half of the bounty's
 * "Automate draws, or provide a documented keeper/admin flow" requirement;
 * this script is the "automate" half.
 *
 * WHAT IT DOES, each pass:
 *   1. Reads `nextDrawId`. The "current" draw is `nextDrawId - 1` (or none
 *      yet, if nextDrawId is 0) — same convention the frontend's
 *      DrawIdContext uses, verified against that file.
 *   2. If that draw's stage is TotalWeightRequested or WinnerRequested,
 *      fetches the KMS-verified plaintext via the relayer SDK's
 *      `publicDecrypt` (same call the frontend makes client-side — no
 *      wallet signature involved in that half, only in the on-chain tx
 *      that follows) and submits it.
 *   3. Otherwise, if `isDrawEligible()` is true (cohort size + interval +
 *      everyone-ready gates all pass — see CairnPool.sol), calls
 *      `requestDrawResolution()` to start the next round.
 *   4. Otherwise, does nothing this pass.
 *
 * USAGE:
 *   One-shot (good for a cron job / GitHub Actions schedule):
 *     npx hardhat run scripts/keeper.ts --network sepolia
 *   Continuous (good for a long-running process, e.g. during a demo):
 *     KEEPER_WATCH=true npx hardhat run scripts/keeper.ts --network sepolia
 *
 * Required env (see config/.env.example):
 *   CAIRN_CONTRACT_ADDRESS — the deployed pool.
 *   KEEPER_PRIVATE_KEY — funded with Sepolia ETH only; no special
 *     privilege required. Falls back to DEPLOYER_PRIVATE_KEY with a
 *     printed warning if unset, so a single-key setup still works for a
 *     quick demo, but a real deployment should use a separate key.
 * Optional env:
 *   KEEPER_WATCH — "true" to loop instead of exiting after one pass.
 *   KEEPER_POLL_INTERVAL_SECONDS — loop interval, default 15.
 */
import { ethers as hardhatEthers } from "hardhat";
import { ethers } from "ethers";
import { setDefaultResultOrder } from "node:dns";
// Node's built-in fetch (undici), which @zama-fhe/relayer-sdk's Node build
// uses internally, defaults to trying IPv6 before IPv4. On many machines
// (WSL2, various cloud VMs, dual-stack networks with a broken/blocked IPv6
// route) that first attempt hangs or fails, and undici surfaces it as an
// opaque `TypeError: fetch failed` wrapped in an `AggregateError` — which
// is exactly the error this script was hitting on relayer key-URL fetches,
// even though the RPC connection (a different HTTP path, via ethers) was
// fine. Forcing IPv4-first resolution is the standard fix for this exact
// symptom. This must run before any fetch call, so it's the first thing
// in the file after imports.
setDefaultResultOrder("ipv4first");
// MUST be the explicit "/node" subpath, not the bare package name. The
// package's package.json "exports" map only lists "./web", "./bundle",
// and "./node" — there is no "." entry — so Node's own module resolver
// (used when Hardhat/ts-node run this file directly, unlike a bundler
// such as Vite which resolves "main"/"module" more loosely) throws
// ERR_PACKAGE_PATH_NOT_EXPORTED on a bare `from "@zama-fhe/relayer-sdk"`.
// The "/node" subpath is also the one that avoids the browser-only WASM
// bootstrapping (initSDK) that "/web" needs — no initSDK() call is
// required here, unlike the frontend's config/zama.ts.
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";

const DRAW_STAGE_NAMES = ["None", "TotalWeightRequested", "TotalWeightSubmitted", "WinnerRequested", "Resolved"] as const;

export function log(msg: string) {
  console.log(`[keeper ${new Date().toISOString()}] ${msg}`);
}

/**
 * Node's default error printing truncates nested causes as `[AggregateError]`
 * / `[cause]: {...}` with no message shown for the actual underlying
 * failure — which is exactly what happened above. Two things needed
 * unwrapping specifically:
 *   1. AggregateError.errors (multiple underlying connection attempts).
 *   2. This SDK's own error shape: it throws `new Error(message, { cause })`
 *      where `cause` is a PLAIN OBJECT `{ code, operation, error, response? }`
 *      — not an Error itself — and `cause.error` holds the actual root
 *      failure. The top-level message ("Bad JSON") is also just a generic
 *      string reused for any fetch-level failure on non-decrypt calls, not
 *      a real signal that JSON parsing was involved — don't read too much
 *      into it. This recurses into `.error` so the real cause surfaces.
 */
export function describeError(err: unknown, depth = 0): string {
  const indent = "  ".repeat(depth);
  if (err instanceof AggregateError) {
    let out = `${indent}AggregateError: ${err.message} (${err.errors.length} underlying attempt(s))`;
    for (const inner of err.errors) out += `\n${describeError(inner, depth + 1)}`;
    return out;
  }
  if (err instanceof Error) {
    let out = `${indent}${err.name}: ${err.message}`;
    if ((err as { cause?: unknown }).cause !== undefined) {
      out += `\n${describeError((err as { cause?: unknown }).cause, depth + 1)}`;
    }
    return out;
  }
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    const context = ["code", "operation"].filter((k) => k in obj).map((k) => `${k}=${obj[k]}`).join(", ");
    let out = `${indent}(relayer error context: ${context || "none"})`;
    if ("error" in obj && obj.error !== undefined) out += `\n${describeError(obj.error, depth + 1)}`;
    if ("response" in obj && obj.response !== undefined) out += `\n${indent}  (a response object was attached — see .status/.statusText if you inspect it directly)`;
    return out;
  }
  return `${indent}${String(err)}`;
}

export async function runOnce(pool: ethers.Contract, fhevmInstance: Awaited<ReturnType<typeof createInstance>>): Promise<void> {
  const nextDrawId: bigint = await pool.nextDrawId();
  const currentDrawId = nextDrawId > 0n ? nextDrawId - 1n : 0n;
  const hasAnyDraw = nextDrawId > 0n;

  const stage = hasAnyDraw ? Number(await pool.drawStage(currentDrawId)) : 0;
  const stageName = DRAW_STAGE_NAMES[stage];

  if (hasAnyDraw && stageName === "TotalWeightRequested") {
    const handle = (await pool.pendingTotalWeightHandle(currentDrawId)) as string;
    log(`Draw ${currentDrawId}: awaiting total weight. Fetching verified value for handle ${handle}...`);
    const result = await fhevmInstance.publicDecrypt([handle]);
    const total = result.clearValues[handle];
    if (typeof total === "bigint" && total === 0n) {
      log(`Draw ${currentDrawId}: total weight is genuinely zero (no deposits this round) — skipping, this would revert on-chain.`);
      return;
    }
    log(`Draw ${currentDrawId}: submitting verified total weight (${total})...`);
    const tx = await pool.submitTotalWeight(currentDrawId, result.abiEncodedClearValues, result.decryptionProof);
    const receipt = await tx.wait();
    log(`Draw ${currentDrawId}: submitTotalWeight confirmed (${receipt?.hash}). Winner drawn and requested in the same tx.`);
    return;
  }

  if (hasAnyDraw && stageName === "WinnerRequested") {
    const handle = (await pool.pendingWinnerHandle(currentDrawId)) as string;
    log(`Draw ${currentDrawId}: awaiting winner. Fetching verified address for handle ${handle}...`);
    const result = await fhevmInstance.publicDecrypt([handle]);
    log(`Draw ${currentDrawId}: submitting verified winner...`);
    const tx = await pool.submitWinner(currentDrawId, result.abiEncodedClearValues, result.decryptionProof);
    const receipt = await tx.wait();
    log(`Draw ${currentDrawId}: submitWinner confirmed (${receipt?.hash}). Draw resolved.`);
    return;
  }

  const eligible: boolean = await pool.isDrawEligible();
  if (eligible) {
    log("A new draw is eligible (cohort size, interval, and everyone-ready gates all pass). Requesting resolution...");
    const tx = await pool.requestDrawResolution();
    const receipt = await tx.wait();
    log(`New draw requested (${receipt?.hash}).`);
    return;
  }

  log(`Nothing to do. Current draw ${hasAnyDraw ? currentDrawId : "(none yet)"} is ${hasAnyDraw ? stageName : "N/A"}; not yet eligible for a new one.`);
}

export async function setupKeeper() {
  const poolAddress = process.env.CAIRN_CONTRACT_ADDRESS;
  if (!poolAddress || !hardhatEthers.isAddress(poolAddress)) {
    throw new Error("CAIRN_CONTRACT_ADDRESS is not set (or not a valid address). This must be a pool already deployed via scripts/deploy.ts.");
  }

  const keeperKey = process.env.KEEPER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY;
  if (!keeperKey) {
    throw new Error("Set KEEPER_PRIVATE_KEY (preferred) or DEPLOYER_PRIVATE_KEY in the environment — the keeper needs a funded Sepolia wallet to pay gas.");
  }
  if (!process.env.KEEPER_PRIVATE_KEY) {
    log("WARNING: KEEPER_PRIVATE_KEY not set — falling back to DEPLOYER_PRIVATE_KEY. Fine for a quick demo; use a separate, less-privileged key for anything longer-lived.");
  }

  const provider = hardhatEthers.provider;
  const keeperWallet = new hardhatEthers.Wallet(keeperKey, provider);
  log(`Keeper wallet: ${keeperWallet.address}`);
  const balance = await provider.getBalance(keeperWallet.address);
  log(`Keeper wallet balance: ${hardhatEthers.formatEther(balance)} ETH`);
  if (balance === 0n) {
    throw new Error(`Keeper wallet ${keeperWallet.address} has 0 Sepolia ETH — fund it before running the keeper.`);
  }

  const pool = (await hardhatEthers.getContractAt("CairnPool", poolAddress)).connect(keeperWallet) as ethers.Contract;

  // The relayer SDK's `network` field accepts an EIP-1193 provider or a
  // plain RPC URL string (verified against the installed package's own
  // FhevmInstanceConfig type) — NOT an ethers Provider instance, so this
  // is deliberately the raw SEPOLIA_RPC_URL string (same variable
  // hardhat.config.ts already reads), not `provider` above.
  const sepoliaRpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!sepoliaRpcUrl) {
    throw new Error("SEPOLIA_RPC_URL is not set — required both for Hardhat's own network config and for the relayer SDK's registry lookups here.");
  }
  const fhevmInstance = await createInstance({
    ...SepoliaConfig,
    network: sepoliaRpcUrl,
  });

  return { pool, fhevmInstance };
}

async function main() {
  const { pool, fhevmInstance } = await setupKeeper();

  const watch = /^true$/i.test(process.env.KEEPER_WATCH || "");
  const pollSeconds = Number(process.env.KEEPER_POLL_INTERVAL_SECONDS || "15");

  if (!watch) {
    await runOnce(pool, fhevmInstance);
    return;
  }

  log(`Watch mode: polling every ${pollSeconds}s. Ctrl+C to stop.`);
  // Deliberately sequential (await inside the loop, not setInterval) so a
  // slow relayer call or tx confirmation can never overlap with the next
  // poll and fire two actions at once.
  for (;;) {
    try {
      await runOnce(pool, fhevmInstance);
    } catch (err) {
      log(`Pass failed, will retry next interval:\n${describeError(err)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
}

// Only auto-run when this file is executed directly (`hardhat run
// scripts/keeper.ts`) — NOT when its exports are imported by another file
// (e.g. scripts/keeperServer.ts for the Render deployment), which would
// otherwise trigger a second, competing run at import time.
if (require.main === module) {
  main().catch((error) => {
    console.error("Keeper failed to start:\n" + describeError(error));
    process.exitCode = 1;
  });
}
