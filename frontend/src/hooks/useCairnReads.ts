import { useAccount, useReadContract } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { CAIRN_POOL_ABI, CAIRN_POOL_ADDRESS, IERC7984_ABI, CUSDT_ADDRESS, isContractConfigured, isCusdtConfigured, DRAW_STAGE } from '../config/contracts';

// Every read below is explicitly pinned to Sepolia via `chainId`. Without
// this, wagmi resolves reads against whatever chain the injected wallet is
// currently pointed at — if that's anything other than Sepolia (mainnet,
// another testnet, or a wallet mid-switch), `useReadContract` throws
// (surfaced to the user as a generic "RPC error") instead of just reading
// Cairn's actual deployment through our own configured Sepolia transport
// (config/web3.ts's fallback across public RPCs / your VITE_SEPOLIA_RPC_URL).
// Reads no longer depend on the wallet's selected network at all — only
// writes do (see useCairnActions.ts), which is the correct split: reading
// Cairn's state shouldn't require the wallet to be on the right chain, only
// submitting a transaction should.
const pool = { address: CAIRN_POOL_ADDRESS as `0x${string}`, abi: CAIRN_POOL_ABI, chainId: sepolia.id } as const;
const cusdt = { address: CUSDT_ADDRESS as `0x${string}`, abi: IERC7984_ABI, chainId: sepolia.id } as const;

// -----------------------------------------------------------------
// CairnPool — encrypted-handle reads (bytes32 ciphertext handles, not
// plaintext values; see context/DecryptedBalancesContext.tsx for turning these into
// numbers).
// -----------------------------------------------------------------

// BUG FIX: neither read below used to poll — a one-shot fetch each.
// That's mostly masked elsewhere by explicit `.refetch()` calls tied to
// this browser's own actions succeeding (see Deposit.tsx). It is NOT
// masked for `useMyPrizeHandle`: nothing here ever refetches it
// automatically before a claim, so a Claim page visited (or left open)
// before `submitWinner` had actually run on chain could cache the
// mapping's pre-set sentinel value — literally the zero handle, which
// `DecryptedBalancesContext`'s zero-handle shortcut resolves straight to
// "0" without ever querying the relayer — and never update, permanently
// showing "+0" even once the real prize was credited on chain. Same class
// of bug as `useNextDrawId` above. Both now poll every 6s.
export function useMyPrincipalHandle() {
  const { address, isConnected } = useAccount();
  return useReadContract({ ...pool, functionName: 'myPrincipal', account: address, query: { enabled: isConnected && isContractConfigured, refetchInterval: 6_000 } });
}

export function useMyPrizeHandle(drawId: bigint) {
  const { address, isConnected } = useAccount();
  return useReadContract({ ...pool, functionName: 'myPrizeForDraw', args: [drawId], account: address, query: { enabled: isConnected && isContractConfigured, refetchInterval: 6_000 } });
}

// -----------------------------------------------------------------
// CairnPool — plaintext, intentionally-public reads
// -----------------------------------------------------------------

export function useParticipantCount() {
  return useReadContract({ ...pool, functionName: 'participantCount', query: { enabled: isContractConfigured, refetchInterval: 6_000 } });
}

/** The address permitted to call `setYieldRateBps`, `setDrawEligibility`, and `fundYieldSource`. */
export function useOwner() {
  return useReadContract({ ...pool, functionName: 'owner', query: { enabled: isContractConfigured } });
}

/** Public protocol parameter — the rate automatically applied to a round's
 * verified total weight to compute that round's prize. See
 * submitTotalWeight's doc comment in CairnPool.sol. */
export function useYieldRateBps() {
  return useReadContract({ ...pool, functionName: 'yieldRateBps', query: { enabled: isContractConfigured } });
}

export function useMaxCohortSize() {
  return useReadContract({ ...pool, functionName: 'maxCohortSize', query: { enabled: isContractConfigured } });
}

export function useMinCohortSize() {
  return useReadContract({ ...pool, functionName: 'minCohortSize', query: { enabled: isContractConfigured } });
}

export function useMinDrawIntervalSeconds() {
  return useReadContract({ ...pool, functionName: 'minDrawIntervalSeconds', query: { enabled: isContractConfigured } });
}

export function useLastDrawRequestedAt() {
  return useReadContract({ ...pool, functionName: 'lastDrawRequestedAt', query: { enabled: isContractConfigured } });
}

/** Whether ANY wallet may currently call `requestDrawResolution()` — the permissionless eligibility check. */
export function useIsDrawEligible() {
  return useReadContract({ ...pool, functionName: 'isDrawEligible', query: { enabled: isContractConfigured, refetchInterval: 6_000 } });
}

/** Whether the connected wallet has marked itself ready for the next draw. */
export function useIsReadyForDraw() {
  const { address, isConnected } = useAccount();
  return useReadContract({ ...pool, functionName: 'readyForDraw', args: [address ?? '0x0000000000000000000000000000000000000000'], account: address, query: { enabled: isConnected && isContractConfigured, refetchInterval: 4_000 } });
}

/** How many of the currently-tracked participants are ready right now — public, not per-user. */
export function useReadyCount() {
  return useReadContract({ ...pool, functionName: 'readyCount', query: { enabled: isContractConfigured, refetchInterval: 4_000 } });
}

/** Whether every currently-tracked participant is ready — the other half of isDrawEligible's gate. */
export function useAllParticipantsReady() {
  return useReadContract({ ...pool, functionName: 'allParticipantsReady', query: { enabled: isContractConfigured, refetchInterval: 4_000 } });
}

/** The next drawId `requestDrawResolution()` will assign — i.e. how many draws have been requested so far. */
export function useNextDrawId() {
  // BUG FIX: every other draw-lifecycle read below polls every 4s — this
  // one didn't, despite being the value DrawIdContext's auto-sync effect
  // depends on to notice a new round has started. Without polling, once a
  // round resolved and a second one was actually requested on chain, the
  // app kept showing the old (stale) round forever, until a manual page
  // reload re-ran the initial fetch.
  return useReadContract({ ...pool, functionName: 'nextDrawId', query: { enabled: isContractConfigured, refetchInterval: 4_000 } });
}

// Every draw-lifecycle read below polls on a short interval. This is the
// fix for a real, verified bug: with a one-shot fetch, two different
// wallets (or two tabs) watching the same draw never saw each other's
// progress, so a stage-gated action could be fired against state that had
// already moved on, or hadn't moved yet, in another session. Polling every
// few seconds while the Draw screen is open is what makes both
// participants actually watch the same live state, and is also what a
// synchronized, trustable draw needs regardless of who has the tab open.
const DRAW_POLL_MS = 4_000;

export function useDrawStage(drawId: bigint) {
  const result = useReadContract({ ...pool, functionName: 'drawStage', args: [drawId], query: { enabled: isContractConfigured, refetchInterval: DRAW_POLL_MS } });
  const raw: unknown = result.data;
  const stageIndex = typeof raw === 'number' ? raw : Number((raw as bigint | undefined) ?? 0);
  const stageName = DRAW_STAGE[stageIndex] ?? 'None';
  return { ...result, stageIndex, stageName };
}

/**
 * Rounds actually resolved to a winner. `nextDrawId` counts draws
 * *requested* (see useNextDrawId above), which is one too many while the
 * latest draw is still in flight (TotalWeightRequested/WinnerRequested) —
 * it only equals "completed" once that latest draw has resolved. This is
 * the single source of truth both Landing.tsx and Draw.tsx read from, so
 * the two screens can never show two different numbers for the same thing
 * again.
 */
export function useCompletedDrawCount() {
  const nextDrawId = useNextDrawId();
  const next = nextDrawId.data as bigint | undefined;
  const latestId = next !== undefined && next > 0n ? next - 1n : 0n;
  const latestStage = useDrawStage(latestId);
  const hasAnyDraw = next !== undefined && next > 0n;
  const data = !hasAnyDraw
    ? 0n
    : latestStage.stageName === 'Resolved'
      ? latestId
      : latestId > 0n
        ? latestId - 1n
        : 0n;
  return { data, isLoading: nextDrawId.isLoading || latestStage.isLoading };
}

export function useResolvedWinner(drawId: bigint) {
  return useReadContract({ ...pool, functionName: 'resolvedWinner', args: [drawId], query: { enabled: isContractConfigured, refetchInterval: DRAW_POLL_MS } });
}

export function useVerifiedTotalWeight(drawId: bigint) {
  return useReadContract({ ...pool, functionName: 'verifiedTotalWeight', args: [drawId], query: { enabled: isContractConfigured, refetchInterval: DRAW_POLL_MS } });
}

export function useDrawCohortSize(drawId: bigint) {
  return useReadContract({ ...pool, functionName: 'drawCohortSize', args: [drawId], query: { enabled: isContractConfigured, refetchInterval: DRAW_POLL_MS } });
}

export function usePrizeClaimed(drawId: bigint) {
  return useReadContract({ ...pool, functionName: 'prizeClaimed', args: [drawId], query: { enabled: isContractConfigured, refetchInterval: DRAW_POLL_MS } });
}

/** The pending (not-yet-verified) ciphertext handle awaiting public decryption — feeds directly into useSubmitTotalWeightAction. */
export function usePendingTotalWeightHandle(drawId: bigint) {
  return useReadContract({ ...pool, functionName: 'pendingTotalWeightHandle', args: [drawId], query: { enabled: isContractConfigured, refetchInterval: DRAW_POLL_MS } });
}

/** The pending (not-yet-verified) winner ciphertext handle — feeds directly into useSubmitWinnerAction. */
export function usePendingWinnerHandle(drawId: bigint) {
  return useReadContract({ ...pool, functionName: 'pendingWinnerHandle', args: [drawId], query: { enabled: isContractConfigured, refetchInterval: DRAW_POLL_MS } });
}

// -----------------------------------------------------------------
// cUSDT (IERC7984) — the real confidential token CairnPool custodies
// -----------------------------------------------------------------

export function useCusdtDecimals() {
  return useReadContract({ ...cusdt, functionName: 'decimals', query: { enabled: isCusdtConfigured } });
}

export function useCusdtSymbol() {
  return useReadContract({ ...cusdt, functionName: 'symbol', query: { enabled: isCusdtConfigured } });
}

/** Encrypted handle of the connected wallet's raw cUSDT balance (before/outside deposit into CairnPool). */
export function useCusdtBalanceHandle() {
  const { address, isConnected } = useAccount();
  return useReadContract({ ...cusdt, functionName: 'confidentialBalanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'], query: { enabled: isConnected && isCusdtConfigured && !!address } });
}

/** Whether CairnPool is currently authorized to move this wallet's cUSDT (the ERC-7984 operator model). */
export function useIsPoolOperator() {
  const { address, isConnected } = useAccount();
  return useReadContract({
    ...cusdt,
    functionName: 'isOperator',
    args: [address ?? '0x0000000000000000000000000000000000000000', CAIRN_POOL_ADDRESS as `0x${string}`],
    query: { enabled: isConnected && isCusdtConfigured && isContractConfigured && !!address },
  });
}