import React from 'react';
import { ViewType } from '../../types';
import { Card, Eyebrow } from '../ui/Card';
import { Button } from '../ui/Button';
import { Tag } from '../ui/Tag';
import { EncryptedValue } from '../ui/EncryptedValue';
import { NotDeployedNotice, WrongNetworkNotice } from '../ui/ContractStatusNotice';
import { motion, AnimatePresence } from 'motion/react';
import { useAccount } from 'wagmi';
import { isContractConfigured } from '../../config/contracts';
import { useNetworkGuard } from '../../hooks/useNetworkGuard';
import { useDrawStage, useResolvedWinner } from '../../hooks/useCairnReads';
import { useDrawId } from '../../context/DrawIdContext';
import { shortAddr } from '../../lib/format';

interface ResultProps {
  setCurrentView: (v: ViewType) => void;
}

export function Result({ setCurrentView }: ResultProps) {
  const { address, isConnected } = useAccount();
  const { isSepolia, switchToSepolia, isSwitching } = useNetworkGuard();
  const { drawId } = useDrawId();

  const stage = useDrawStage(drawId);
  const winner = useResolvedWinner(drawId);

  const isResolved = stage.stageName === 'Resolved';
  const isWinner = isResolved && isConnected && !!winner.data && !!address && (winner.data as string).toLowerCase() === address.toLowerCase();

  return (
    <div className="flex flex-col w-full h-full pb-8 items-center">
      <div className="flex items-center justify-between p-[8px_24px_0] md:p-[8px_40px_0] w-full max-w-[700px]">
        <div>
          <h1 className="text-[28px] md:text-[32px] text-white">Claim</h1>
          <div className="text-text-2 text-[14px] mt-[4px]">
            {isResolved ? `Round ${drawId.toString()} resolved` : stage.stageName === 'None' ? `Round ${drawId.toString()} hasn't started` : `Round ${drawId.toString()} is resolving`}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] md:gap-[24px] p-[20px_24px_40px] md:p-[32px_40px_56px] w-full max-w-[700px]">
        {!isContractConfigured && <NotDeployedNotice />}
        {isContractConfigured && isConnected && !isSepolia && (
          <WrongNetworkNotice onSwitch={switchToSepolia} isSwitching={isSwitching} />
        )}

        <AnimatePresence mode="popLayout">
          {!isConnected ? (
            <motion.div key="disconnected" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Card className="text-center bg-[#12100C] p-[40px_24px]">
                <div className="font-d text-[20px] font-[560] mb-[8px] text-white">Connect your wallet to see your result</div>
                <div className="text-[14px] text-text-2 max-w-[380px] mx-auto">Whether you won Round {drawId.toString()} depends on which address is connected.</div>
              </Card>
            </motion.div>
          ) : !isResolved ? (
            <motion.div key="pending" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Card className="text-center bg-[#12100C] p-[40px_24px]">
                <Tag variant="illustrative">Not yet resolved</Tag>
                <div className="font-d text-[22px] font-[560] mt-[16px] mb-[8px] text-white">
                  {stage.stageName === 'None' ? `Round ${drawId.toString()} hasn't started` : `Round ${drawId.toString()} is resolving`}
                </div>
                <div className="text-[14px] text-text-2 max-w-[420px] mx-auto">
                  {stage.stageName === 'None'
                    ? 'It starts automatically once every saver marks themselves ready. No one has to click anything to advance it.'
                    : 'Every step here runs on its own, over encrypted weights. This page updates the moment a winner is picked.'}
                </div>
                <Button variant="secondary" className="mt-[24px]" onClick={() => setCurrentView('draw')}>Watch it live on Draw</Button>
              </Card>
            </motion.div>
          ) : isWinner ? (
            <motion.div key="win" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <div className="text-center p-[40px_24px] rounded-[24px] bg-[radial-gradient(circle_at_50%_0%,_rgba(214,138,76,0.12),_transparent_70%),_var(--color-surface-2)] border border-bdr-strong shadow-elevation-2 relative overflow-hidden">
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[200px] h-[1px] bg-gradient-to-r from-transparent via-accent-2 to-transparent opacity-50" />
                <Tag variant="public" className="mb-[16px]">Draw complete</Tag>
                <div className="font-d text-[24px] md:text-[28px] font-[560] mt-[8px] mb-[6px] text-white">You won Round {drawId.toString()}</div>
                <div className="text-[14px] text-text-2 mb-[32px] max-w-[400px] mx-auto leading-relaxed">
                  Winning address <span className="text-text-1 font-semibold">{shortAddr(winner.data as string)}</span> is now public, but your prize amount is not.
                </div>
                <div className="flex justify-center h-[40px] items-center mb-[16px]">
                  <EncryptedValue />
                </div>
                <div className="mt-[12px]"><Tag variant="you">Only you can decrypt this</Tag></div>
              </div>
              <Button className="w-full mt-[24px] h-[52px] text-[15px]" onClick={() => setCurrentView('claim')}>Reveal your prize</Button>
            </motion.div>
          ) : (
            <motion.div key="lose" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
              <Card className="text-center bg-[#12100C] p-[40px_24px]">
                <Tag variant="public">Draw complete</Tag>
                <div className="font-d text-[24px] font-[560] mt-[20px] mb-[8px] text-white">You didn't win this round.</div>
                <div className="text-[14px] text-text-2 max-w-[420px] mx-auto leading-relaxed">
                  Winning address <span className="text-text-1 font-semibold">{winner.data ? shortAddr(winner.data as string) : '–'}</span>. Your balance was never revealed to anyone.
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
