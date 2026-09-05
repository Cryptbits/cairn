import { useCallback, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { toHex } from 'viem';
import { callFhevm } from '../config/zama';
import { CAIRN_POOL_ABI, CAIRN_POOL_ADDRESS, IERC7984_ABI, CUSDT_ADDRESS, isContractConfigured, isCusdtConfigured } from '../config/contracts';

export type ActionStatus =
  | 'idle'
  | 'preparing' // encrypting the input client-side via the relayer SDK
  | 'signing' // wallet prompt for the transaction
  | 'submitting' // broadcast, awaiting a hash
  | 'confirming' // waiting for the receipt
  | 'success'
  | 'rejected'
  | 'failed';

function classifyTxError(err: unknown): { status: ActionStatus; message: string } {
  const msg = String((err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? err ?? '');
  if (/ZERO_TOTAL_WEIGHT/.test(msg)) return { status: 'failed', message: "Nobody had any weight this round. No deposits at all, so there's nothing to draw over." };
  if (/user rejected|denied|reject/i.test(msg)) return { status: 'rejected', message: 'Wallet rejected the request.' };
  if (/chain mismatch|does not match the target chain|switch.*chain|unsupported chain/i.test(msg)) {
    return { status: 'failed', message: 'Your wallet is on the wrong network. Switch to Sepolia and try again.' };
  }
  if (/no position/i.test(msg)) return { status: 'failed', message: 'Deposit before using this action — this account has no position yet.' };
  if (/not enough participants/i.test(msg)) return { status: 'failed', message: 'Not enough participants yet for a draw.' };
  if (/too soon since last draw/i.test(msg)) return { status: 'failed', message: 'A draw was requested too recently — try again shortly.' };
  if (/not awaiting total weight/i.test(msg)) return { status: 'failed', message: "This draw isn't waiting on a total weight submission right now — the page may be a step behind. Refresh and try again." };
  if (/zero total weight, nothing to draw over/i.test(msg)) return { status: 'failed', message: 'No draw weight was committed this round, so there\'s nothing to draw over.' };
  if (/winner not requested/i.test(msg)) return { status: 'failed', message: "This draw isn't waiting on a winner submission right now — the page may be a step behind. Refresh and try again." };
  if (/not the winner/i.test(msg)) return { status: 'failed', message: 'Only the resolved winner can claim this prize.' };
  if (/already claimed/i.test(msg)) return { status: 'failed', message: 'This prize has already been claimed.' };
  if (/draw not resolved/i.test(msg)) return { status: 'failed', message: 'This draw has not resolved yet.' };
  if (/insufficient funds/i.test(msg)) return { status: 'failed', message: 'Insufficient Sepolia ETH to pay gas for this transaction.' };
  if (/not owner/i.test(msg)) return { status: 'failed', message: 'Only the wallet that deployed CairnPool can do this. Connect that wallet and try again.' };
  if (/rpc request failed|http request failed|free plan|rate limit|429|too many requests|upgrade to a paid|-32005|-32603/i.test(msg)) {
    return { status: 'failed', message: 'Sepolia network hiccup. Try again in a moment.' };
  }
  if (/network|fetch|timeout|relayer/i.test(msg)) return { status: 'failed', message: 'Encryption service unavailable. Try again in a moment.' };
  return { status: 'failed', message: 'Transaction failed. Try again.' };
}

/** Generic write-tx state machine shared by every action below. */
function useTxAction<Args extends unknown[]>(run: (...args: Args) => Promise<void>) {
  const { reset: resetWrite } = useWriteContract();
  const [status, setStatus] = useState<ActionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>(undefined);
  const receipt = useWaitForTransactionReceipt({ hash: txHash });

  const guardedRun = useCallback(
    async (...args: Args) => {
      // BUG FIX: the "preparing" loading state used to be set and then
      // immediately followed by heavy, synchronous client-side FHE
      // encryption work (WASM inside `callFhevm`/`instance.encrypt()`, or
      // the equivalent decrypt-side work). That work blocks the main
      // thread, and a browser only paints between yielded turns of the
      // event loop — so React's state update was committed in memory
      // immediately, but the screen itself didn't actually repaint until
      // the blocking work finished. The visible symptom was a button that
      // looked completely unresponsive for a second or more before any
      // spinner appeared. `flushSync` forces the "preparing" UI to commit
      // synchronously, and the double-rAF wait below forces the browser to
      // actually paint that commit, before we ever call into `run()` and
      // its potentially-blocking work.
      flushSync(() => {
        setErrorMessage(null);
        setStatus('preparing');
      });
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      try {
        await run(...args);
      } catch (err: unknown) {
        const { status: s, message } = classifyTxError(err);
        setStatus(s);
        setErrorMessage(message);
      }
    },
    [run],
  );

  const reset = useCallback(() => {
    setStatus('idle');
    setErrorMessage(null);
    setTxHash(undefined);
    resetWrite();
  }, [resetWrite]);

  const derivedStatus: ActionStatus = useMemo(() => {
    if (!txHash) return status;
    if (receipt.isSuccess) return 'success';
    if (receipt.isError) return 'failed';
    return 'confirming';
  }, [txHash, receipt.isSuccess, receipt.isError, status]);

  return { status: derivedStatus, error: derivedStatus === 'failed' && !errorMessage ? 'Transaction reverted on chain.' : errorMessage, run: guardedRun, reset, txHash, setTxHash, setStatus };
}

// -----------------------------------------------------------------
// cUSDT operator approval (the ERC-7984 equivalent of ERC-20 `approve`)
// -----------------------------------------------------------------

/**
 * `CUSDT.setOperator(CairnPool, until)` — verified against the real,
 * compiled IERC7984 interface (config/IERC7984.abi.json). Must be called
 * once (or re-called after expiry) before a user's first deposit; without
 * it `confidentialTransferFrom` inside CairnPool.deposit will revert.
 */
export function useApproveOperatorAction() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async (durationDays: number = 30) => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isCusdtConfigured) throw new Error('No cUSDT address is configured.');
    const until = Math.floor(Date.now() / 1000) + durationDays * 24 * 60 * 60;
    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CUSDT_ADDRESS as `0x${string}`,
      abi: IERC7984_ABI,
      functionName: 'setOperator',
      args: [CAIRN_POOL_ADDRESS, until],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}

// -----------------------------------------------------------------
// Encrypted-amount actions: deposit / withdraw
// -----------------------------------------------------------------

/**
 * Shared implementation for the two encrypted-amount entry points:
 * `deposit`, `withdraw`. Both share the identical "encrypt client-side →
 * sign tx → wait for receipt" shape (verified against
 * contracts/CairnPool.sol).
 *
 * UNITS: `amount` is a raw integer in the token's smallest unit (i.e.
 * already multiplied by 10**decimals by the caller) — see lib/format.ts's
 * `toBaseUnits`, which reads the real on-chain `decimals()` rather than
 * assuming one.
 */
function useEncryptedAmountAction(functionName: 'deposit' | 'withdraw') {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async (amount: bigint) => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isContractConfigured) throw new Error('CairnPool has not been deployed yet — no contract address is configured.');

    const { handles, inputProof } = await callFhevm(async (instance) => {
      const input = instance.createEncryptedInput(CAIRN_POOL_ADDRESS as string, address);
      input.add64(amount);
      return input.encrypt();
    });
    const handleHex = toHex(handles[0]);
    const proofHex = toHex(inputProof);

    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CAIRN_POOL_ADDRESS as `0x${string}`,
      abi: CAIRN_POOL_ABI,
      functionName,
      args: [handleHex, proofHex],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}

export function useDepositAction() {
  return useEncryptedAmountAction('deposit');
}
export function useWithdrawAction() {
  return useEncryptedAmountAction('withdraw');
}

/**
 * Owner-only: `CairnPool.fundYieldSource(handle, proof)`. Seeds the prize
 * reserve `submitTotalWeight` automatically pays each round's prize out of
 * (see that function's doc comment in CairnPool.sol) — a pool with nothing
 * seeded here resolves every draw with a real, verifiable, but silently $0
 * prize. Same encrypt-then-sign shape as deposit/withdraw above, reusing
 * the existing cUSDT operator approval (`useApproveOperatorAction`) — the
 * contract calls `confidentialTransferFrom` internally exactly like
 * `deposit` does, so the same operator grant covers both.
 */
export function useFundYieldSourceAction() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async (amount: bigint) => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isContractConfigured) throw new Error('CairnPool has not been deployed yet — no contract address is configured.');

    const { handles, inputProof } = await callFhevm(async (instance) => {
      const input = instance.createEncryptedInput(CAIRN_POOL_ADDRESS as string, address);
      input.add64(amount);
      return input.encrypt();
    });
    const handleHex = toHex(handles[0]);
    const proofHex = toHex(inputProof);

    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CAIRN_POOL_ADDRESS as `0x${string}`,
      abi: CAIRN_POOL_ABI,
      functionName: 'fundYieldSource',
      args: [handleHex, proofHex],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}

// -----------------------------------------------------------------
// Permissionless draw lifecycle — any wallet may call these once eligible
// -----------------------------------------------------------------

// -----------------------------------------------------------------
// Draw readiness — on-chain "I'm ready" signal (see CairnPool.sol's
// readyForDraw/readyCount/allParticipantsReady). requestDrawResolution()
// now hard-reverts until every tracked participant has called this with
// `true` — that's what makes the draw a real multi-party synchronization
// instead of whoever clicks first.
// -----------------------------------------------------------------

export function useSetReadyForDrawAction() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async (ready: boolean) => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isContractConfigured) throw new Error('CairnPool has not been deployed yet.');
    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CAIRN_POOL_ADDRESS as `0x${string}`,
      abi: CAIRN_POOL_ABI,
      functionName: 'setReadyForDraw',
      args: [ready],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}

/** `requestDrawResolution()` — no drawId/count args; the contract self-sequences. */
export function useRequestDrawResolutionAction() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async () => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isContractConfigured) throw new Error('CairnPool has not been deployed yet.');
    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CAIRN_POOL_ADDRESS as `0x${string}`,
      abi: CAIRN_POOL_ABI,
      functionName: 'requestDrawResolution',
      args: [],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}

/**
 * `submitTotalWeight(drawId, cleartexts, proof)` — fetches the KMS-verified
 * total weight via the relayer SDK's public-decryption endpoint, then
 * submits it. In the same on-chain transaction, the contract also draws a
 * winner from that total and requests the winner's decryption — there's no
 * separate "resolve" step to call afterward (see the doc comment on
 * `submitTotalWeight` in CairnPool.sol for why merging those two steps is
 * safe). No wallet signature is needed for the `publicDecrypt` call itself
 * (it's a public, unauthenticated read from the relayer); the wallet only
 * signs the actual on-chain transaction.
 *
 * If the decrypted total comes back as zero (nobody in the round had any
 * weight), this deliberately does NOT submit — a zero total is guaranteed
 * to revert on-chain (`submitTotalWeight` reverts with "zero total weight,
 * nothing to draw over"), so there's no reason to spend gas finding that
 * out. The plaintext total is already sitting right here in `clearValues`,
 * fetched from the relayer before any transaction was ever sent, so the
 * check costs nothing.
 */
export function useSubmitTotalWeightAction() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async (drawId: bigint, totalWeightHandle: `0x${string}`) => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isContractConfigured) throw new Error('CairnPool has not been deployed yet.');

    const result = await callFhevm((instance) => instance.publicDecrypt([totalWeightHandle]));

    const decryptedTotal = result.clearValues[totalWeightHandle];
    if (typeof decryptedTotal === 'bigint' && decryptedTotal === 0n) {
      throw new Error('ZERO_TOTAL_WEIGHT');
    }

    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CAIRN_POOL_ADDRESS as `0x${string}`,
      abi: CAIRN_POOL_ABI,
      functionName: 'submitTotalWeight',
      args: [drawId, result.abiEncodedClearValues, result.decryptionProof],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}

/** `submitWinner(drawId, cleartexts, proof)` — same shape as submitTotalWeight, for the winner handle. */
export function useSubmitWinnerAction() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async (drawId: bigint, winnerHandle: `0x${string}`) => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isContractConfigured) throw new Error('CairnPool has not been deployed yet.');

    const result = await callFhevm((instance) => instance.publicDecrypt([winnerHandle]));

    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CAIRN_POOL_ADDRESS as `0x${string}`,
      abi: CAIRN_POOL_ABI,
      functionName: 'submitWinner',
      args: [drawId, result.abiEncodedClearValues, result.decryptionProof],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}

// -----------------------------------------------------------------
// Claim
// -----------------------------------------------------------------

/**
 * `claimPrize(drawId)` — real payout. Credits the resolved winner's
 * encrypted prize into their principal on-chain (see CairnPool.sol); after
 * this confirms, the amount is confidentially withdrawable through the
 * normal withdraw flow. Reverts (surfaced via classifyTxError) if the
 * caller isn't the resolved winner or already claimed.
 */
export function useClaimPrizeAction() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();

  const action = useTxAction(async (drawId: bigint) => {
    if (!address) throw new Error('Connect your wallet first.');
    if (!isContractConfigured) throw new Error('CairnPool has not been deployed yet.');
    action.setStatus('signing');
    const hash = await writeContractAsync({
      address: CAIRN_POOL_ADDRESS as `0x${string}`,
      abi: CAIRN_POOL_ABI,
      functionName: 'claimPrize',
      args: [drawId],
      account: address,
      chain: sepolia,
    });
    action.setTxHash(hash);
    action.setStatus('submitting');
  });

  return action;
}
