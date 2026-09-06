import React from 'react';
import { ViewType } from '../../types';
import { Button } from '../ui/Button';
import { Tag } from '../ui/Tag';
import { Card } from '../ui/Card';
import { motion } from 'motion/react';
import { isContractConfigured } from '../../config/contracts';
import { useParticipantCount, useCompletedDrawCount } from '../../hooks/useCairnReads';

interface LandingProps {
  setCurrentView: (v: ViewType) => void;
}

export function Landing({ setCurrentView }: LandingProps) {
  const participantCount = useParticipantCount();
  const completedDraws = useCompletedDrawCount();

  return (
    <motion.div className="w-full flex flex-col min-h-screen" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
      <nav className="flex items-center justify-between p-[20px_24px] md:p-[32px_48px] w-full max-w-[1200px] mx-auto">
        <div className="flex items-center gap-[12px]">
          <svg className="w-[28px] h-[24px] shrink-0 self-center" viewBox="0 0 26 22" fill="none"><rect x="2" y="16" width="22" height="5" rx="2.2" fill="#5C5646"/><rect x="5.5" y="9" width="15" height="5" rx="2.2" fill="#8B6A45"/><rect x="9" y="2" width="8" height="5" rx="2.2" fill="#E9A165"/></svg>
          <span className="font-d text-[22px] font-[560] tracking-[0.01em] text-text-1 self-center leading-none">Cairn</span>
        </div>
        <Button size="sm" onClick={() => setCurrentView('home')}>Launch app</Button>
      </nav>

      <main className="flex-1 w-full flex flex-col items-center pt-[4vh] md:pt-[10vh]">
        <div className="px-[24px] text-center max-w-[720px] mx-auto flex flex-col items-center">
          <h1 className="font-d font-[540] text-[40px] md:text-[56px] leading-[1.1] tracking-tight mb-[20px] text-white">
            Save together.<br />Stay private.
          </h1>

          <p className="text-text-2 text-[16px] md:text-[18px] leading-[1.6] max-w-[560px] mx-auto">
            Cairn is a no-loss prize pool. Your balance, your draw strategy, and your odds are encrypted end-to-end. Only you can ever see them. Winner selection still runs verifiably onchain.
          </p>
        </div>

        <div className="w-full max-w-[800px] mt-[36px] md:mt-[44px] border-y border-bdr-strong flex bg-surface-2/30 backdrop-blur-sm">
          <div className="flex-1 text-center p-[28px_16px] border-r border-bdr-strong">
            <div className="font-d text-[28px] md:text-[32px] font-[560] num text-white">
              {isContractConfigured && participantCount.data !== undefined ? String(participantCount.data) : '–'}
            </div>
            <div className="text-[11px] font-semibold tracking-wider text-text-2 mt-[6px]">PARTICIPANTS</div>
          </div>
          <div className="flex-1 text-center p-[28px_16px] border-r border-bdr-strong">
            <div className="font-d text-[28px] md:text-[32px] font-[560] num text-white">
              {isContractConfigured && completedDraws.data !== undefined ? String(completedDraws.data) : '–'}
            </div>
            <div className="text-[11px] font-semibold tracking-wider text-text-2 mt-[6px]">DRAWS COMPLETED</div>
          </div>
          <div className="flex-1 text-center p-[28px_16px]">
            <div className="font-d text-[28px] md:text-[32px] font-[560] num text-text-3">Encrypted</div>
            <div className="text-[11px] font-semibold tracking-wider text-text-2 mt-[6px]">PRIZE RESERVE</div>
          </div>
        </div>
        {!isContractConfigured && (
          <div className="text-[12px] text-text-3 mt-[10px]">CairnPool isn't deployed yet. Figures above will populate once it is.</div>
        )}

        <div className="w-full max-w-[1000px] grid grid-cols-1 md:grid-cols-2 gap-[24px] mt-[48px] md:mt-[64px] px-[24px] pb-[80px]">
          <Card className="bg-[#12100C]">
            <Tag variant="encrypted">Encrypted</Tag>
            <h3 className="font-d font-[560] text-[20px] mt-[16px] mb-[10px] text-text-1">What Cairn protects</h3>
            <p className="text-text-2 text-[14px] leading-[1.7]">
              Every deposit and every balance is encrypted on chain. Never visible to other savers, never visible to us.
            </p>
          </Card>
          <Card className="bg-[#12100C]">
            <Tag variant="public">Public</Tag>
            <h3 className="font-d font-[560] text-[20px] mt-[16px] mb-[10px] text-text-1">What's independently verifiable</h3>
            <p className="text-text-2 text-[14px] leading-[1.7]">
              Pool size, the draw schedule, and the winning address once a draw resolves. Anyone can confirm a draw was fair, without seeing anyone's balance.
            </p>
          </Card>
        </div>
      </main>
    </motion.div>
  );
}