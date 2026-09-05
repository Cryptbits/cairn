import { TokenIcon } from "../ui/TokenIcon";
import React, { useEffect, useRef } from 'react';
import { ViewType } from '../../types';
import { Card, Eyebrow } from '../ui/Card';
import { Button } from '../ui/Button';
import { EncryptedValue } from '../ui/EncryptedValue';
import { TransactionState } from '../ui/TransactionState';
import { Callout } from '../ui/Callout';
import { NotDeployedNotice, WrongNetworkNotice } from '../ui/ContractStatusNotice';
import { motion, AnimatePresence } from 'motion/react';
import { useAccount } from 'wagmi';
import { isContractConfigured } from '../../config/contracts';
import { useNetworkGuard } from '../../hooks/useNetworkGuard';
import { useMyPrizeHandle, useResolvedWinner, usePrizeClaimed, useDrawStage, useCusdtDecimals, useCusdtSymbol } from '../../hooks/useCairnReads';
import { useSharedDecrypt } from '../../context/DecryptedBalancesContext';
import { useClaimPrizeAction } from '../../hooks/useCairnActions';
import { useDrawId } from '../../context/DrawIdContext';
import { fromBaseUnits, displaySymbol } from '../../lib/format';

export function Claim({ setCurrentView }: { setCurrentView: (v: ViewType) => void }) {
  const { address, isConnected } = useAccount();
  const { isSepolia, switchToSepolia, isSwitching } = useNetworkGuard();
  const { drawId } = useDrawId();

  const stage = useDrawStage(drawId);
  const prizeHandle = useMyPrizeHandle(drawId);
  const winner = useResolvedWinner(drawId);
  const claimed = usePrizeClaimed(drawId);
  const decrypt = useSharedDecrypt(prizeHandle.data as `0x${string}` | undefined);
  const claimAction = useClaimPrizeAction();
  const decimalsRead = useCusdtDecimals();
  const symbolRead = useCusdtSymbol();
  const decimals = typeof decimalsRead.data === 'number' ? decimalsRead.data : 6;
  const symbol = displaySymbol(typeof symbolRead.data === 'string' ? symbolRead.data : undefined);

  const isResolved = stage.stageName === 'Resolved';
  const isWinner = isResolved && !!winner.data && !!address && (winner.data as string).toLowerCase() === address.toLowerCase();
  const decrypted = decrypt.status === 'success';
  const isBusy = decrypt.status === 'preparing' || decrypt.status === 'signing' || decrypt.status === 'decrypting';
  const isClaiming = claimAction.status !== 'idle';

  const decryptTerminalError = decrypt.status === 'error' || decrypt.status === 'unauthorized';

  const handleDecrypt = () => {
    if (!isConnected) return;
    decrypt.decrypt();
  };

  const handleClaim = () => {
    claimAction.run(drawId);
  };

  const prevClaimStatus = useRef(claimAction.status);
  useEffect(() => {
    if (prevClaimStatus.current !== 'success' && claimAction.status === 'success') {
      claimed.refetch();
      prizeHandle.refetch();
    }
    prevClaimStatus.current = claimAction.status;
  }, [claimAction.status]);

  const statusMode = decrypt.status === 'success' ? 'success' : decryptTerminalError ? 'error' : 'processing';

  return (
    <div className="flex flex-col w-full h-full pb-8 items-center">
      <div className="flex items-center justify-between p-[8px_24px_0] md:p-[8px_40px_0] w-full max-w-[640px]">
        <div>
          <h1 className="text-[28px] md:text-[32px] text-white">Collect prize</h1>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] md:gap-[24px] p-[20px_24px_40px] md:p-[32px_40px_56px] w-full max-w-[640px]">
        {!isContractConfigured && <NotDeployedNotice />}
        {isContractConfigured && isConnected && !isSepolia && (
          <WrongNetworkNotice onSwitch={switchToSepolia} isSwitching={isSwitching} />
        )}

        <Card className="bg-[#12100C] overflow-hidden">
          {!isResolved ? (
            <div className="text-center py-[24px]">
              <Eyebrow className="mb-[12px]">This draw hasn't resolved yet</Eyebrow>
              <div className="text-[14px] text-text-2 max-w-[380px] mx-auto mb-[20px]">
                Round {drawId.toString()} is still at stage "{stage.stageName}". There's nothing to claim until it resolves.
              </div>
              <Button variant="secondary" onClick={() => setCurrentView('draw')}>Check draw status</Button>
            </div>
          ) : !isWinner ? (
            <div className="text-center py-[24px]">
              <Eyebrow className="mb-[12px]">You weren't the winner</Eyebrow>
              <div className="text-[14px] text-text-2 max-w-[380px] mx-auto mb-[20px]">
                Round {drawId.toString()} resolved to a different address. Your balance was never revealed to anyone.
              </div>
              <Button variant="secondary" onClick={() => setCurrentView('result')}>Back to Claim</Button>
            </div>
          ) : (
          <AnimatePresence mode="popLayout" initial={false}>
            {isBusy || decryptTerminalError || isClaiming ? (
              <motion.div key="decrypting" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="py-[24px]">
                {isClaiming ? (
                  <TransactionState
                    status={claimAction.status === 'success' ? 'success' : claimAction.status === 'rejected' || claimAction.status === 'failed' ? 'error' : 'processing'}
                    title={claimAction.status === 'success' ? 'Prize claimed' : claimAction.status === 'rejected' ? 'Wallet rejected the request' : claimAction.status === 'failed' ? 'Claim failed' : 'Claiming your prize'}
                    subtitle={claimAction.status === 'success' ? `Credited into your encrypted principal. Withdraw it anytime from Deposit.` : claimAction.error ?? 'Submitting your claim…'}
                    onDismiss={() => claimAction.reset()}
                    errorAction={() => claimAction.reset()}
                  />
                ) : (
                  <TransactionState
                    status={statusMode}
                    title={
                      decrypt.status === 'unauthorized'
                        ? "You're not the winner of this draw"
                        : decrypt.status === 'error'
                          ? 'Decryption failed'
                          : decrypt.status === 'signing'
                            ? 'Awaiting wallet signature'
                            : decrypt.status === 'decrypting'
                              ? 'Decrypting your private prize'
                              : 'Preparing decryption request'
                    }
                    subtitle={
                      decrypt.status === 'unauthorized'
                        ? 'Only the winning address for this draw can decrypt this prize. That\'s expected if you weren\'t the winner.'
                        : decrypt.status === 'error'
                          ? decrypt.error ?? 'Try again.'
                          : 'Authorizing decryption in your wallet via an EIP-712 signature.'
                    }
                    onDismiss={() => decrypt.reset()}
                    errorAction={() => decrypt.reset()}
                  />
                )}
              </motion.div>
            ) : (
              <motion.div key="content" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                <div className="text-center p-[40px_24px] rounded-[20px] bg-surface-2 border border-bdr-strong shadow-inset-deep relative mb-[32px]">
                  <Eyebrow className="mb-[12px]">Your prize amount</Eyebrow>
                  <div className="h-[64px] flex items-center justify-center">
                    <AnimatePresence mode="popLayout">
                      {decrypted ? (
                        <motion.div key="amount" initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} className="flex items-center justify-center font-d text-[48px] md:text-[56px] font-[560] leading-none num text-white">
                          +{fromBaseUnits(decrypt.value, decimals)}
                          <div className="flex items-center gap-[6px] ml-3 mt-[6px]">
                            <TokenIcon className="w-[20px] h-[20px] md:w-[24px] md:h-[24px]" />
                            <span className="text-[20px] md:text-[24px] text-text-3 font-b">{symbol}</span>
                          </div>
                        </motion.div>
                      ) : (
                        <motion.div key="enc" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.05 }} className="flex h-full items-center">
                          <EncryptedValue className="scale-[1.5]" />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {!decrypted ? (
                  <>
                    <Callout variant="plain" className="mb-[24px]">
                      Your prize amount is currently encrypted onchain. Sign with your wallet to decrypt and view it, just for you.
                      {!isWinner && isContractConfigured && ' If this draw has resolved and you were not the winner, this decryption request will correctly fail.'}
                    </Callout>
                    <Button className="w-full h-[52px] text-[15px]" onClick={handleDecrypt} disabled={!isConnected || !isContractConfigured || !prizeHandle.data}>
                      {!isConnected ? 'Connect Wallet' : 'Decrypt & reveal'}
                    </Button>
                  </>
                ) : claimed.data === true ? (
                  <Callout variant="plain">This prize has already been claimed and credited into your encrypted principal.</Callout>
                ) : decrypt.value === 0n ? (
                  <Callout variant="plain">
                    This round's prize was 0. The most likely reason: the pool's owner hadn't funded the yield source yet when this
                    round resolved. Nothing to claim here, but your principal is untouched and stays fully withdrawable.
                  </Callout>
                ) : (
                  <>
                    <Callout variant="primary" className="mb-[16px]">
                      Claiming credits this prize directly into your encrypted CairnPool principal. It's real, onchain, and immediately withdrawable from Deposit/Withdraw afterward.
                    </Callout>
                    <Button className="w-full h-[52px] text-[15px]" onClick={handleClaim} disabled={!isConnected || !isWinner}>
                      Claim to my principal
                    </Button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          )}
        </Card>
      </div>
    </div>
  );
}
