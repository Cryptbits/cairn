import React, { useEffect, useRef, useState } from 'react';
import { Card, Eyebrow } from '../ui/Card';
import { Button } from '../ui/Button';
import { Callout } from '../ui/Callout';
import { TransactionState } from '../ui/TransactionState';
import { NotDeployedNotice, WrongNetworkNotice } from '../ui/ContractStatusNotice';
import { motion, AnimatePresence } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { isContractConfigured } from '../../config/contracts';
import { useNetworkGuard } from '../../hooks/useNetworkGuard';
import {
  useDrawStage,
  useDrawCohortSize,
  useResolvedWinner,
  useIsDrawEligible,
  useParticipantCount,
  useMinCohortSize,
  usePrizeClaimed,
  usePendingTotalWeightHandle,
  usePendingWinnerHandle,
  useIsReadyForDraw,
  useReadyCount,
  useOwner,
} from '../../hooks/useCairnReads';
import {
  useRequestDrawResolutionAction,
  useSubmitTotalWeightAction,
  useSubmitWinnerAction,
  useSetReadyForDrawAction,
} from '../../hooks/useCairnActions';
import { useDrawId } from '../../context/DrawIdContext';
import { shortAddr } from '../../lib/format';
import { ViewType } from '../../types';

function liveStatusText(
  stageName: string | undefined,
  anyBusy: boolean,
  winnerAddr: string | undefined,
  isZeroAddr: boolean
): string {
  if (stageName === 'Resolved') {
    const who = winnerAddr && !isZeroAddr ? shortAddr(winnerAddr) : 'unknown';
    return `Draw complete. Winner ${who}`;
  }
  if (stageName === 'None') return anyBusy ? 'Preparing cohort' : 'Awaiting resolution';
  if (stageName === 'TotalWeightRequested' || stageName === 'WinnerRequested') {
    return anyBusy ? 'Confirming on chain' : 'Resolving over encrypted weights';
  }
  return 'Awaiting resolution';
}

function isBusy(status: string) {
  return status !== 'idle' && status !== 'success' && status !== 'failed' && status !== 'rejected';
}

export function Draw({ setCurrentView }: { setCurrentView: (v: ViewType) => void }) {
  const { isConnected, address } = useAccount();
  const { isSepolia, switchToSepolia, isSwitching } = useNetworkGuard();
  const { drawId, setDrawId, isLive, goLive } = useDrawId();

  const stage = useDrawStage(drawId);
  const cohortSize = useDrawCohortSize(drawId);
  const winner = useResolvedWinner(drawId);
  const claimed = usePrizeClaimed(drawId);
  const eligible = useIsDrawEligible();
  const participantCount = useParticipantCount();
  const minCohort = useMinCohortSize();
  const pendingWeightHandle = usePendingTotalWeightHandle(drawId);
  const pendingWinnerHandle = usePendingWinnerHandle(drawId);
  const myReady = useIsReadyForDraw();
  const readyCount = useReadyCount();
  const owner = useOwner();

  const isOwner = isConnected && !!owner.data && !!address && (owner.data as string).toLowerCase() === address.toLowerCase();

  const requestAction = useRequestDrawResolutionAction();
  const submitWeightAction = useSubmitTotalWeightAction();
  const submitWinnerAction = useSubmitWinnerAction();
  const readyAction = useSetReadyForDrawAction();

  const isZeroAddr = winner.data === '0x0000000000000000000000000000000000000000';
  const isMyWin = isConnected && winner.data && !isZeroAddr && (winner.data as string).toLowerCase() === address?.toLowerCase();

  const refetchAll = () => {
    stage.refetch();
    cohortSize.refetch();
    winner.refetch();
    claimed.refetch();
    eligible.refetch();
    participantCount.refetch();
    pendingWeightHandle.refetch();
    pendingWinnerHandle.refetch();
    myReady.refetch();
    readyCount.refetch();
  };

  const handleRequest = () => requestAction.run();
  const handleMarkReady = () => {
    if (myReady.data) return; 
    readyAction.run(true);
  };
  const handleUnready = () => readyAction.run(false);
  const handleSubmitWeight = () => {
    const handle = pendingWeightHandle.data as `0x${string}` | undefined;
    if (!handle) return;
    submitWeightAction.run(drawId, handle);
  };
  const handleSubmitWinner = () => {
    const handle = pendingWinnerHandle.data as `0x${string}` | undefined;
    if (!handle) return;
    submitWinnerAction.run(drawId, handle);
  };

  const prevStatuses = useRef({ request: requestAction.status, weight: submitWeightAction.status, winner: submitWinnerAction.status, ready: readyAction.status });
  useEffect(() => {
    const prev = prevStatuses.current;
    if (
      (prev.request !== 'success' && requestAction.status === 'success') ||
      (prev.weight !== 'success' && submitWeightAction.status === 'success') ||
      (prev.winner !== 'success' && submitWinnerAction.status === 'success') ||
      (prev.ready !== 'success' && readyAction.status === 'success')
    ) {
      refetchAll();
    }
    prevStatuses.current = { request: requestAction.status, weight: submitWeightAction.status, winner: submitWinnerAction.status, ready: readyAction.status };
  }, [requestAction.status, submitWeightAction.status, submitWinnerAction.status, readyAction.status]);


  const disabledBase = !isConnected || !isContractConfigured || (isConnected && !isSepolia);

  const anyBusy = isBusy(requestAction.status) || isBusy(submitWeightAction.status) || isBusy(submitWinnerAction.status);
  let phase = 0;
  if (stage.stageName === 'Resolved') phase = 3;
  else if (stage.stageName === 'TotalWeightRequested' || stage.stageName === 'WinnerRequested') phase = anyBusy ? 2 : 1;
  else if (stage.stageName === 'None' && anyBusy) phase = 2;

  const liveStatus = liveStatusText(stage.stageName, anyBusy, winner.data as string | undefined, isZeroAddr);

  const [cols, setCols] = useState(() => Array.from({ length: 32 }).map(() => ({ height: 15 + Math.random() * 25, hot: false })));
  const resolving = phase === 1 || phase === 2;
  useEffect(() => {
    if (!resolving) return;
    const interval = setInterval(() => {
      setCols(Array.from({ length: 32 }).map(() => ({ height: 15 + Math.random() * 85, hot: Math.random() > 0.7 })));
    }, 150);
    return () => clearInterval(interval);
  }, [resolving]);
  const settledRef = useRef(false);
  useEffect(() => {
    if (phase === 3 && !settledRef.current) {
      settledRef.current = true;
      const highlight = Math.floor(Math.random() * 32);
      setCols(Array.from({ length: 32 }).map((_, i) => ({ height: i === highlight ? 120 : 10 + Math.random() * 15, hot: i === highlight })));
    }
    if (phase !== 3) settledRef.current = false;
  }, [phase]);

  return (
    <div className="flex flex-col w-full h-full pb-8 items-center">
      <div className="flex items-center justify-between p-[8px_24px_0] md:p-[8px_40px_0] w-full max-w-[760px]">
        <div>
          <h1 className="text-[28px] md:text-[32px] text-white">Draw</h1>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] md:gap-[24px] p-[20px_24px_40px] md:p-[32px_40px_56px] w-full max-w-[760px]">
        {!isContractConfigured && <NotDeployedNotice />}
        {isContractConfigured && isConnected && !isSepolia && (
          <WrongNetworkNotice onSwitch={switchToSepolia} isSwitching={isSwitching} />
        )}

        <Card className="bg-[#12100C]">
          <div className="flex items-center justify-between mb-[20px] gap-[12px]">
            <div className="flex items-center gap-[8px]">
              <Eyebrow className="mb-0">Draw number</Eyebrow>
              <input
                type="number"
                min={0}
                value={drawId.toString()}
                onChange={(e) => setDrawId(BigInt(Math.max(0, Number(e.target.value) || 0)))}
                onWheel={(e) => (e.target as HTMLInputElement).blur()}
                aria-label="Draw number, automatically set to the current draw, editable to check a past one"
                className="w-[56px] bg-surface-2 border border-bdr-strong rounded-[8px] px-[8px] py-[3px] text-[13px] font-semibold text-white num outline-none focus:border-accent-2/50"
                title="Automatically set to the current draw. Change it to check a past draw."
              />
              {!isLive && (
                <button
                  type="button"
                  onClick={goLive}
                  className="text-[11.5px] font-semibold text-accent-2 hover:text-accent-2/80 underline decoration-dotted underline-offset-2 transition-colors"
                >
                  Back to live round
                </button>
              )}
            </div>
          </div>

          <div className="flex items-end justify-center gap-[4px] h-[140px] py-[10px] mt-[16px] mb-[32px] overflow-hidden border-b border-bdr relative">
            <AnimatePresence>
              {resolving && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 0.15 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-accent-2 blur-3xl rounded-full" />
              )}
            </AnimatePresence>
            {cols.map((c, i) => (
              <motion.div
                key={i}
                className={`w-[12px] rounded-t-[4px] relative z-10 ${c.hot ? 'bg-gradient-to-t from-accent to-accent-2 shadow-[0_0_12px_rgba(233,161,101,0.5)]' : 'bg-surface-2 border-x border-t border-bdr-strong'}`}
                animate={{ height: c.height }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              />
            ))}
          </div>

          <div className="flex flex-col gap-[8px] bg-surface-2 p-[16px_20px] rounded-[16px] border border-bdr">
            <div className="flex items-center justify-between py-[6px]">
              <span className="text-[14px] text-text-2">Live status</span>
              <AnimatePresence mode="popLayout">
                <motion.span
                  key={liveStatus}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -5 }}
                  className={`text-[14px] font-semibold ${phase === 3 ? 'text-positive' : 'text-white'}`}
                >
                  {isContractConfigured ? liveStatus : '–'}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="flex items-center justify-between py-[6px]">
              <span className="text-[14px] text-text-2">Savers in this round</span>
              <span className="text-[14px] font-semibold num text-white">
                {cohortSize.data !== undefined && Number(cohortSize.data) > 0 ? String(cohortSize.data) : (participantCount.data !== undefined ? String(participantCount.data) : '–')}
              </span>
            </div>
            <div className="flex items-center justify-between py-[6px]">
              <span className="text-[14px] text-text-2">Winner</span>
              <span className="text-[13px] font-mono font-semibold tracking-wider text-white">
                {winner.data && !isZeroAddr ? shortAddr(winner.data as string) : '–'}
                {isMyWin && <span className="ml-[8px] text-accent-2">(you!)</span>}
              </span>
            </div>
            {stage.stageName === 'Resolved' && (
              <div className="flex items-center justify-between py-[6px]">
                <span className="text-[14px] text-text-2">Prize claimed</span>
                <span className="text-[14px] font-semibold text-white">{claimed.data ? 'Yes' : 'Not yet'}</span>
              </div>
            )}
          </div>

          {stage.stageName === 'None' && (
            <>
              {/* Real, on-chain "I'm ready" toggle (setReadyForDraw). This is
                  what makes the draw a genuine multi-party synchronization
                  instead of a single click: requestDrawResolution() hard-
                  reverts on-chain until every tracked participant has this
                  on. Once you're ready, the button becomes a plain status —
                  no re-click, no second "un-ready" transaction by accident.
                  Starting the draw itself is the keeper bot's job (see
                  scripts/keeper.ts) — no saver, including this one, is ever
                  asked to sign that transaction. */}
              <div className="flex items-center justify-between p-[14px_16px] mb-[16px] rounded-[14px] bg-surface-2 border border-bdr">
                <div>
                  <div className="text-[14px] font-semibold text-white">
                    {myReady.data ? 'Waiting for others…' : 'Ready for this draw'}
                  </div>
                  <div className="text-[12.5px] text-text-2 mt-[2px]">
                    {readyCount.data !== undefined && participantCount.data !== undefined
                      ? `${String(readyCount.data)} of ${String(participantCount.data)} savers ready`
                      : 'Waiting on real numbers…'}
                    {myReady.data && Number(participantCount.data ?? 0) > Number(readyCount.data ?? 0) && (
                      <>
                        {' · '}
                        <button
                          type="button"
                          onClick={handleUnready}
                          disabled={disabledBase || readyAction.status !== 'idle'}
                          className="underline decoration-dotted underline-offset-2 hover:text-text-1 transition-colors disabled:opacity-40"
                        >
                          not ready anymore?
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {myReady.data ? (
                  <div className="flex items-center gap-[8px] text-[13px] font-semibold text-accent-2 px-[14px] py-[9px]">
                    <Loader2 className="w-[14px] h-[14px] animate-spin" />
                    Ready ✓
                  </div>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={disabledBase || readyAction.status !== 'idle'}
                    onClick={handleMarkReady}
                  >
                    {readyAction.status !== 'idle' ? 'Confirming…' : "I'm ready"}
                  </Button>
                )}
              </div>

              {/* The draw is started by the keeper bot (scripts/keeper.ts),
                  not by this browser — see the note above `stage.stageName
                  === 'None'`. This panel shows real progress once *some*
                  wallet's requestDrawResolution lands (the keeper's, or the
                  owner's manual fallback below), and otherwise is a plain
                  status message — never a countdown to this tab's own
                  auto-fire. */}
              <AnimatePresence mode="popLayout" initial={false}>
                {requestAction.status !== 'idle' ? (
                  <motion.div key="request-tx" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                    <TransactionState
                      status={requestAction.status === 'success' ? 'success' : requestAction.status === 'failed' || requestAction.status === 'rejected' ? 'error' : 'processing'}
                      title={
                        requestAction.status === 'success' ? 'Draw started'
                        : requestAction.status === 'failed' || requestAction.status === 'rejected' ? "Draw didn't start"
                        : requestAction.status === 'preparing' ? 'Preparing'
                        : requestAction.status === 'signing' ? 'Awaiting wallet signature'
                        : requestAction.status === 'submitting' ? 'Submitting transaction'
                        : 'Confirming on chain'
                      }
                      subtitle={requestAction.status === 'success' ? 'Weight is now being verified.' : (requestAction.error ?? 'Starting this draw…')}
                      onDismiss={() => requestAction.reset()}
                      errorAction={handleRequest}
                      showEtherscanLink={requestAction.status === 'success'}
                      txHash={requestAction.txHash}
                    />
                  </motion.div>
                ) : (
                  <motion.div key="request-idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-[10px] py-[6px]">
                    <div className="text-center text-[13px] text-text-3">
                      {!isConnected
                        ? 'Connect your wallet to mark yourself ready.'
                        : eligible.data === true
                          ? 'Everyone is ready. The keeper bot starts the draw automatically — usually within a minute.'
                          : Number(participantCount.data ?? 0) < Number(minCohort.data ?? 0)
                            ? `Needs ${minCohort.data !== undefined ? String(minCohort.data) : 'more'} savers before a draw can start.`
                            : 'The draw starts automatically the moment every saver here is ready.'}
                    </div>
                    {/* Owner-only fallback for when the keeper bot is
                        offline — documented in README under "If the keeper
                        is down". Never rendered for a regular saver: no
                        depositor should ever be asked to pay gas starting a
                        draw on everyone else's behalf. */}
                    {isOwner && eligible.data === true && (
                      <Button variant="secondary" size="sm" onClick={handleRequest}>
                        Admin: start draw now
                      </Button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {(stage.stageName === 'TotalWeightRequested' || stage.stageName === 'WinnerRequested') && (
            <AnimatePresence mode="popLayout" initial={false}>
              {(() => {
                const action = stage.stageName === 'TotalWeightRequested' ? submitWeightAction : submitWinnerAction;
                const retry = stage.stageName === 'TotalWeightRequested' ? handleSubmitWeight : handleSubmitWinner;
                const isZeroWeight = stage.stageName === 'TotalWeightRequested' && (action.status === 'failed' || action.status === 'rejected') && /nothing to draw over/i.test(action.error ?? '');
                if (isZeroWeight) {
                  return (
                    <motion.div key="zero-weight" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                      <Callout variant="plain">
                        {action.error} Deposit before the next draw.
                      </Callout>
                    </motion.div>
                  );
                }
                if (action.status === 'idle') {
                  // Watch-only for everyone except the owner: the keeper
                  // bot (scripts/keeper.ts) is the thing that normally
                  // fetches the verified value and submits it here, on its
                  // own wallet. See the note above `stage.stageName ===
                  // 'None'` for why no saver's browser does this anymore.
                  return (
                    <motion.div key="idle-watch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-[10px] py-[6px]">
                      <div className="text-center text-[13px] text-text-3">
                        {stage.stageName === 'TotalWeightRequested'
                          ? 'Verifying total weight and drawing a winner — the keeper bot handles this automatically.'
                          : 'Verifying the winner — the keeper bot handles this automatically.'}
                      </div>
                      {isOwner && (
                        <Button variant="secondary" size="sm" onClick={retry}>
                          Admin: continue draw now
                        </Button>
                      )}
                    </motion.div>
                  );
                }
                return (
                  <motion.div key="confirm-tx" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                    <TransactionState
                      status={action.status === 'success' ? 'success' : action.status === 'failed' || action.status === 'rejected' ? 'error' : 'processing'}
                      title={
                        action.status === 'success' ? 'Confirmed'
                        : action.status === 'failed' || action.status === 'rejected' ? "That didn't go through"
                        : action.status === 'preparing' ? 'Preparing'
                        : action.status === 'signing' ? 'Awaiting wallet signature'
                        : action.status === 'submitting' ? 'Submitting transaction'
                        : 'Confirming on chain'
                      }
                      subtitle={
                        action.status === 'success'
                          ? (stage.stageName === 'TotalWeightRequested' ? 'Winner requested. One more step to go.' : 'Draw complete. Check Claim.')
                          : (action.error ?? 'Confirming…')
                      }
                      onDismiss={() => action.reset()}
                      errorAction={retry}
                      showEtherscanLink={action.status === 'success'}
                      txHash={action.txHash}
                    />
                  </motion.div>
                );
              })()}
            </AnimatePresence>
          )}

          {stage.stageName === 'Resolved' && isMyWin && claimed.data === false && (
            <Callout variant="primary">You won this round. Head to Claim to reveal and collect your prize.</Callout>
          )}
        </Card>

        <button
          type="button"
          onClick={() => setCurrentView('privacy')}
          className="self-center text-[12.5px] text-text-3 hover:text-text-1 transition-colors underline decoration-dotted underline-offset-2"
        >
          How draw resolution works →
        </button>
      </div>
    </div>
  );
}
