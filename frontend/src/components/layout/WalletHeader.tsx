import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Wallet, Activity, AlertCircle } from 'lucide-react';
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { isContractConfigured } from '../../config/contracts';

export function WalletHeader() {
  const [isHovered, setIsHovered] = useState(false);
  // Previously fire-and-forget: `connect()`/`disconnect()` were never
  // awaited or wrapped in try/catch, so a rejected promise (e.g. MetaMask's
  // "already processing eth_requestAccounts" -32002 when a click landed
  // mid-transition) failed silently — the button looked dead until a full
  // page refresh cleared the wallet's own pending-request lock. Tracking
  // our own busy flag stops a second click from firing while one is still
  // in flight, and surfacing the real error means a genuine failure (e.g.
  // the wallet extension itself being stuck) is at least visible instead of
  // invisible.
  const [isBusy, setIsBusy] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const chainId = useChainId();

  const isSepolia = chainId === 11155111;

  const handleConnectClick = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setConnectError(null);
    try {
      if (isConnected && !isSepolia) {
        await switchChainAsync({ chainId: 11155111 });
      } else if (isConnected) {
        await disconnectAsync();
      } else {
        const injected = connectors.find((c) => c.id === 'injected' || c.id === 'metaMask');
        const target = injected ?? connectors[0];
        if (!target) {
          setConnectError('No wallet extension found. Install MetaMask or another injected wallet.');
        } else {
          await connectAsync({ connector: target });
        }
      }
    } catch (err: any) {
      const msg = String(err?.shortMessage || err?.message || err);
      if (/reject|denied/i.test(msg)) {
        setConnectError(null); // user declined — not worth alarming them over
      } else if (/already processing|-32002/i.test(msg)) {
        setConnectError('Your wallet already has a pending request. Open the extension to approve or dismiss it.');
      } else {
        setConnectError('Could not connect. Try again, or reopen your wallet extension.');
      }
    } finally {
      setIsBusy(false);
    }
  };

  const formattedAddress = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : '';

  return (
    <div
      className="relative flex flex-col items-end gap-[6px]"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
    <div className="relative flex items-center justify-end h-[36px]">
      <AnimatePresence mode="wait">
        {!isHovered && isConnected && isContractConfigured && isSepolia ? (
          <motion.div
            key="live"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            className="flex items-center gap-[8px] px-[12px] py-[6px] rounded-full bg-[#12100C] border border-bdr-strong shadow-sm cursor-default"
          >
            <Activity size={14} className="text-positive" strokeWidth={2.5} />
            <span className="text-[11.5px] font-semibold text-text-1 tracking-[0.08em] uppercase">CAIRN IS LIVE</span>
          </motion.div>
        ) : (
          <motion.div
            key="wallet"
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.15 }}
            onClick={handleConnectClick}
            aria-busy={isBusy}
            className={`flex items-center gap-[12px] px-[16px] py-[8px] rounded-full bg-surface border border-bdr shadow-elevation-1 transition-colors ${isBusy ? 'opacity-60 cursor-wait' : 'cursor-pointer hover:bg-surface-hover'}`}
          >
            {isConnected ? (
              <>
                <div className="flex flex-col gap-[3px] items-end">
                  <span className="text-[13px] font-bold text-text-1 font-d tracking-wide leading-none">{formattedAddress}</span>
                  <span className={`text-[10px] font-semibold uppercase tracking-wider leading-none ${isSepolia ? 'text-text-3' : 'text-red-400'}`}>
                    {isBusy ? 'Working…' : isSepolia ? 'Sepolia' : 'Wrong Network'}
                  </span>
                </div>
                <div className="w-[28px] h-[28px] rounded-full bg-[#1A1813] border border-bdr-strong flex items-center justify-center">
                  <Wallet size={14} className="text-text-2" />
                </div>
              </>
            ) : (
              <span className="text-[13px] font-bold text-text-1">{isBusy ? 'Connecting…' : 'Connect Wallet'}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    {connectError && (
      <div className="flex items-center gap-[6px] px-[10px] py-[5px] rounded-[8px] bg-red-500/10 border border-red-500/20 max-w-[240px]">
        <AlertCircle size={12} className="text-red-400 shrink-0" />
        <span className="text-[11px] leading-tight text-red-300">{connectError}</span>
      </div>
    )}
    </div>
  );
}
