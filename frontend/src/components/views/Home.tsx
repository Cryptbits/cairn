import { TokenIcon } from "../ui/TokenIcon";

import React, { useState } from 'react';
import { ViewType } from '../../types';
import { Button } from '../ui/Button';
import { Card, Eyebrow } from '../ui/Card';
import { Tag } from '../ui/Tag';
import { EncryptedValue } from '../ui/EncryptedValue';
import { Callout } from '../ui/Callout';
import { NotDeployedNotice, WrongNetworkNotice } from '../ui/ContractStatusNotice';
import { EyeOff, Eye, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAccount } from 'wagmi';
import { isContractConfigured } from '../../config/contracts';
import { useNetworkGuard } from '../../hooks/useNetworkGuard';
import { useMyPrincipalHandle, useParticipantCount, useCusdtDecimals, useCusdtSymbol } from '../../hooks/useCairnReads';
import { useSharedDecryptGroup } from '../../context/DecryptedBalancesContext';
import { fromBaseUnits, displaySymbol } from '../../lib/format';
import { useDrawId } from '../../context/DrawIdContext';

interface HomeProps {
  setCurrentView: (v: ViewType) => void;
}

export function Home({ setCurrentView }: HomeProps) {
  const { isConnected } = useAccount();
  const { isSepolia, switchToSepolia, isSwitching } = useNetworkGuard();
  const { drawId } = useDrawId();

  const principalHandle = useMyPrincipalHandle();
  const decryptGroup = useSharedDecryptGroup([principalHandle.data as `0x${string}` | undefined]);
  const [principalEntry] = decryptGroup.entries;
  const participantCount = useParticipantCount();
  const decimalsRead = useCusdtDecimals();
  const symbolRead = useCusdtSymbol();
  const decimals = typeof decimalsRead.data === 'number' ? decimalsRead.data : 6;
  const symbol = displaySymbol(typeof symbolRead.data === 'string' ? symbolRead.data : undefined);

  const [hidden, setHidden] = useState(false);
  const revealed = principalEntry.status === 'success' && !hidden;
  const canReveal = isConnected && isSepolia && isContractConfigured && !!principalHandle.data;

  const handleToggleReveal = () => {
    if (principalEntry.status === 'success') {
      setHidden((h) => !h);
      return;
    }
    setHidden(false);
    decryptGroup.decrypt();
  };

  const revealLabel = () => {
    if (!isConnected) return 'Connect Wallet';
    if (decryptGroup.status === 'preparing') return 'Preparing…';
    if (decryptGroup.status === 'signing') return 'Sign in wallet…';
    if (decryptGroup.status === 'decrypting') return 'Decrypting…';
    return revealed ? 'Hide' : 'Reveal';
  };

  const isBusyDecrypting = ['preparing', 'signing', 'decrypting'].includes(decryptGroup.status);

  const isNewSaver = revealed && principalEntry.value === 0n;

  return (
    <div className="flex flex-col w-full h-full pb-8">
      <div className="flex items-center justify-between p-[8px_24px_0] md:p-[8px_40px_0] max-w-[1000px] w-full mx-auto">
        <div>
          <h1 className="text-[28px] md:text-[32px] text-white">Home</h1>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] md:gap-[24px] p-[20px_24px_40px] md:p-[32px_40px_56px] max-w-[1000px] w-full mx-auto">
        {!isContractConfigured && <NotDeployedNotice />}
        {isContractConfigured && isConnected && !isSepolia && (
          <WrongNetworkNotice onSwitch={switchToSepolia} isSwitching={isSwitching} />
        )}

        <Card className="bg-[#12100C]">
          <div className="flex items-start justify-between flex-wrap gap-[16px]">
            <div>
              <Eyebrow>Your position</Eyebrow>
              <div className="h-[48px] md:h-[56px] flex items-center mt-[12px] mb-[8px]">
                <AnimatePresence mode="popLayout">
                  {revealed ? (
                    <motion.div
                      key="revealed"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="flex items-center font-d font-medium text-[40px] md:text-[52px] tracking-tight leading-none text-white"
                    >
                      <span className="num">{fromBaseUnits(principalEntry.value, decimals)}</span>
                      <div className="flex items-center gap-[6px] ml-3 mt-[4px]">
                        <TokenIcon className="w-[20px] h-[20px] md:w-[24px] md:h-[24px]" />
                        <span className="text-[20px] md:text-[24px] text-text-3 font-b">{symbol}</span>
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="hidden"
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="flex h-full items-center"
                    >
                      {isBusyDecrypting ? (
                        <Loader2 className="w-[28px] h-[28px] text-accent-2 animate-spin" />
                      ) : (
                        <EncryptedValue />
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {principalEntry.status === 'error' && (
                <div className="text-[12.5px] text-red-400 mb-[8px]">{principalEntry.error}</div>
              )}
              <div className="flex gap-[8px] mt-[12px]">
                <Tag variant="encrypted">Encrypted</Tag>
                <Tag variant="you">Visible only to you</Tag>
              </div>
              <div className="text-[12.5px] text-text-3 mt-[10px]">This amount is also your draw weight, so your odds of winning scale with it.</div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="mt-[16px] md:mt-0"
              onClick={handleToggleReveal}
              disabled={!canReveal || isBusyDecrypting}
            >
              {revealed ? <EyeOff size={16} strokeWidth={1.8} /> : <Eye size={16} strokeWidth={1.8} />}
              {revealLabel()}
            </Button>
          </div>

          <hr className="h-[1px] bg-bdr-strong border-none my-[24px]" />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
            <div className="rounded-[14px] border border-bdr bg-[#0F0D0A] p-[16px]">
              <Eyebrow className="mb-0">Round</Eyebrow>
              <div className="font-d font-[520] text-[26px] leading-none mt-[14px] num text-white h-[26px] flex items-center">{drawId.toString()}</div>
              <Tag variant="public" className="mt-[10px]">Current</Tag>
            </div>

            <div className="rounded-[14px] border border-bdr bg-[#0F0D0A] p-[16px]">
              <Eyebrow className="mb-0">Participants</Eyebrow>
              <div className="font-d font-[520] text-[26px] leading-none mt-[14px] num text-text-1 h-[26px] flex items-center">
                {participantCount.data !== undefined ? String(participantCount.data) : '–'}
              </div>
              <Tag variant="public" className="mt-[10px]">Public</Tag>
            </div>
          </div>
        </Card>

        {isNewSaver && (
          <Callout variant="primary">
            You don't have any principal in Cairn yet. Deposit first, then Draw will have something to work with.
          </Callout>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px] md:gap-[24px]">
          <Card tight interactive as="button" onClick={() => setCurrentView('deposit')} className={`w-full h-full text-left bg-surface-2 group ${isNewSaver ? 'ring-1 ring-accent/40' : ''}`}>
            <Eyebrow>Deposit</Eyebrow>
            <div className="font-d text-[18px] font-[520] mt-[8px] text-white transition-colors group-hover:text-accent-2">Add funds</div>
            <div className="text-[13px] text-text-2 mt-[4px]">Principal, always withdrawable</div>
          </Card>
          <Card tight interactive as="button" onClick={() => setCurrentView('draw')} className="w-full h-full text-left bg-surface-2 group">
            <Eyebrow>Draw</Eyebrow>
            <div className="font-d text-[18px] font-[520] mt-[8px] text-white transition-colors group-hover:text-accent-2">Check status</div>
            <div className="text-[13px] text-text-2 mt-[4px]">Real onchain stage</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
