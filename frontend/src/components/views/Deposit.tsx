import { TokenIcon } from "../ui/TokenIcon";
import React, { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Card, Eyebrow } from '../ui/Card';
import { EncryptedValue } from '../ui/EncryptedValue';
import { Callout } from '../ui/Callout';
import { GetTestTokens } from '../ui/GetTestTokens';
import { TransactionState } from '../ui/TransactionState';
import { NotDeployedNotice, WrongNetworkNotice } from '../ui/ContractStatusNotice';
import { motion, AnimatePresence } from 'motion/react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAccount } from 'wagmi';
import { isContractConfigured, isCusdtConfigured, CUSDT_ADDRESS } from '../../config/contracts';
import { useNetworkGuard } from '../../hooks/useNetworkGuard';
import { useDepositAction, useWithdrawAction, useApproveOperatorAction } from '../../hooks/useCairnActions';
import { useMyPrincipalHandle, useCusdtDecimals, useCusdtSymbol, useIsPoolOperator, useCusdtBalanceHandle } from '../../hooks/useCairnReads';
import { useSharedDecrypt } from '../../context/DecryptedBalancesContext';
import { toBaseUnits, fromBaseUnits, displaySymbol } from '../../lib/format';

const QUICK_AMOUNTS = [
  { label: '25%', pct: 0.25 },
  { label: '50%', pct: 0.5 },
  { label: '75%', pct: 0.75 },
  { label: 'Max', pct: 1 },
] as const;

export function Deposit() {
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState('');
  const { isConnected } = useAccount();
  const { isSepolia, switchToSepolia, isSwitching } = useNetworkGuard();

  const decimalsRead = useCusdtDecimals();
  const symbolRead = useCusdtSymbol();
  const decimals = typeof decimalsRead.data === 'number' ? decimalsRead.data : 6;
  const symbol = displaySymbol(typeof symbolRead.data === 'string' ? symbolRead.data : undefined);

  const isOperator = useIsPoolOperator();
  const approveAction = useApproveOperatorAction();
  const depositAction = useDepositAction();
  const withdrawAction = useWithdrawAction();
  const action = mode === 'deposit' ? depositAction : withdrawAction;
  const principalHandle = useMyPrincipalHandle();
  const walletBalanceHandle = useCusdtBalanceHandle();
  const decryptState = useSharedDecrypt(principalHandle.data as `0x${string}` | undefined);

  const walletDecryptState = useSharedDecrypt(walletBalanceHandle.data as `0x${string}` | undefined, CUSDT_ADDRESS as string);

  const needsApproval = mode === 'deposit' && isCusdtConfigured && isOperator.data === false;
  const isSubmitting = action.status !== 'idle';
  const isApproving = approveAction.status !== 'idle';

  const handleApprove = () => {
    approveAction.run(30);
  };

  const lastRevealedPrincipalRef = useRef<bigint | null>(null);

  const handleSubmit = () => {
    if (!isConnected) return;
    const parsed = toBaseUnits(amount, decimals);
    if (parsed <= 0n) return;
    lastRevealedPrincipalRef.current = mode === 'withdraw' && decryptState.status === 'success' ? decryptState.value : null;
    action.run(parsed);
  };

  const requestedBase = amount ? toBaseUnits(amount, decimals) : 0n;
  const knownPrincipal = lastRevealedPrincipalRef.current;
  const withdrawWasClamped = mode === 'withdraw' && knownPrincipal !== null && requestedBase > knownPrincipal;

  const withdrawAmountUnknown = mode === 'withdraw' && knownPrincipal === null;

  const prevActionStatus = useRef(action.status);
  useEffect(() => {
    if (prevActionStatus.current !== 'success' && action.status === 'success') {
      principalHandle.refetch();
      walletBalanceHandle.refetch();
      decryptState.reset();
      walletDecryptState.reset();
    }
    prevActionStatus.current = action.status;
  }, [action.status]);

  const prevApproveStatus = useRef(approveAction.status);
  useEffect(() => {
    if (prevApproveStatus.current !== 'success' && approveAction.status === 'success') {
      isOperator.refetch();
    }
    prevApproveStatus.current = approveAction.status;
  }, [approveAction.status]);

  const getTxStatusMode = () => {
    if (action.status === 'success') return 'success';
    if (action.status === 'rejected' || action.status === 'failed') return 'error';
    return 'processing';
  };

  const getTitle = () => {
    if (action.status === 'success') return mode === 'deposit' ? 'Deposit confirmed' : 'Withdrawal confirmed';
    if (action.status === 'rejected') return 'Wallet rejected the request';
    if (action.status === 'failed') return mode === 'deposit' ? 'Deposit failed' : 'Withdrawal failed';
    if (action.status === 'preparing') return 'Encrypting your amount';
    if (action.status === 'signing') return 'Awaiting wallet signature';
    if (action.status === 'submitting') return 'Submitting transaction';
    return 'Confirming on chain';
  };

  const getSubtitle = () => {
    if (action.status === 'success') {
      if (mode === 'deposit') return `Real ${symbol} moved into CairnPool and your encrypted principal was updated.`;
      if (withdrawWasClamped) return `Your request exceeded your available principal, so CairnPool sent back your full ${fromBaseUnits(knownPrincipal!, decimals)} ${symbol} balance instead.`;
      if (withdrawAmountUnknown) return `Real ${symbol} was transferred back to your wallet and your encrypted principal was updated. Reveal your balance to see the new total.`;
      return `Real ${symbol} was transferred back to your wallet and your encrypted principal was updated.`;
    }
    if (action.status === 'failed' || action.status === 'rejected') return action.error ?? 'Try again.';
    return mode === 'deposit' ? `Building the encrypted deposit via the Zama relayer…` : 'Building the encrypted withdrawal request…';
  };

  const [walletHidden, setWalletHidden] = useState(false);
  const [principalHidden, setPrincipalHidden] = useState(false);

  const handleRevealBalance = () => {
    if (mode === 'deposit') {
      if (walletDecryptState.status === 'success') {
        setWalletHidden((h) => !h);
        return;
      }
      setWalletHidden(false);
      walletDecryptState.decrypt();
    } else {
      if (decryptState.status === 'success') {
        setPrincipalHidden((h) => !h);
        return;
      }
      setPrincipalHidden(false);
      decryptState.decrypt();
    }
  };

  const activeHidden = mode === 'deposit' ? walletHidden : principalHidden;

  const activeDecrypt = mode === 'deposit' ? walletDecryptState : decryptState;
  const isBusyDecrypting = ['preparing', 'signing', 'decrypting'].includes(activeDecrypt.status);

  const pendingPctRef = useRef<number | null>(null);
  const applyPercentage = (pct: number) => {
    if (activeDecrypt.status === 'success' && activeDecrypt.value !== null) {
      const portion = pct >= 1 ? activeDecrypt.value : (activeDecrypt.value * BigInt(Math.round(pct * 1000))) / 1000n;
      setAmount(fromBaseUnits(portion, decimals));
      return;
    }
    pendingPctRef.current = pct;
    handleRevealBalance();
  };
  const handleQuickAmount = (preset: (typeof QUICK_AMOUNTS)[number]) => applyPercentage(preset.pct);

  useEffect(() => {
    if (pendingPctRef.current !== null && activeDecrypt.status === 'success' && activeDecrypt.value !== null) {
      const pct = pendingPctRef.current;
      const portion = pct >= 1 ? activeDecrypt.value : (activeDecrypt.value * BigInt(Math.round(pct * 1000))) / 1000n;
      setAmount(fromBaseUnits(portion, decimals));
      pendingPctRef.current = null;
    }
    if (pendingPctRef.current !== null && activeDecrypt.status === 'error') {
      pendingPctRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDecrypt.status, activeDecrypt.value]);

  return (
    <div className="flex flex-col w-full h-full pb-8 items-center">
      <div className="flex items-center justify-between p-[8px_24px_0] md:p-[8px_40px_0] w-full max-w-[640px]">
        <div>
          <h1 className="text-[28px] md:text-[32px] text-white">Deposit</h1>
          <div className="text-text-2 text-[14px] mt-[4px]">Principal stays fully withdrawable, anytime</div>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] md:gap-[24px] p-[20px_24px_40px] md:p-[32px_40px_56px] w-full max-w-[640px]">
        {!isContractConfigured && <NotDeployedNotice />}
        {isContractConfigured && isConnected && !isSepolia && (
          <WrongNetworkNotice onSwitch={switchToSepolia} isSwitching={isSwitching} />
        )}
        {isContractConfigured && !isCusdtConfigured && (
          <Callout variant="plain">
            Cairn isn't connected to cUSDT right now, so deposits aren't available yet.
          </Callout>
        )}

        <Card className="bg-[#12100C] overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            {isSubmitting || isApproving ? (
              <motion.div key="transaction" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="py-[24px]">
                {isApproving ? (
                  <TransactionState
                    status={approveAction.status === 'success' ? 'success' : approveAction.status === 'rejected' || approveAction.status === 'failed' ? 'error' : 'processing'}
                    title={approveAction.status === 'success' ? 'CairnPool approved' : approveAction.status === 'rejected' ? 'Wallet rejected the request' : approveAction.status === 'failed' ? 'Approval failed' : 'Approving CairnPool as operator'}
                    subtitle={approveAction.status === 'success' ? `CairnPool can now move your ${symbol} for deposits, for the next 30 days.` : approveAction.error ?? `Authorizing CairnPool to move your ${symbol}, like an ERC-20 approve.`}
                    onDismiss={() => approveAction.reset()}
                    errorAction={() => approveAction.reset()}
                  />
                ) : (
                  <TransactionState
                    status={getTxStatusMode()}
                    title={getTitle()}
                    subtitle={getSubtitle()}
                    amount={
                      action.status === 'success' && mode === 'withdraw'
                        ? withdrawWasClamped
                          ? fromBaseUnits(knownPrincipal!, decimals)
                          : withdrawAmountUnknown
                            ? undefined
                            : amount || '0'
                        : amount || '0'
                    }
                    symbol={symbol}
                    onDismiss={() => action.reset()}
                    errorAction={() => action.reset()}
                    showEtherscanLink={action.status === 'success'}
                    txHash={action.txHash}
                  />
                )}
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                <div className="flex p-[4px] rounded-[12px] bg-surface-2 border border-bdr-strong mb-[24px] relative">
                  <div className="flex w-full relative z-10">
                    <button className={`flex-1 py-[8px] text-[13px] font-semibold rounded-[8px] transition-colors ${mode === 'deposit' ? 'text-accent-2' : 'text-text-2 hover:text-text-1'}`} onClick={() => setMode('deposit')}>Deposit</button>
                    <button className={`flex-1 py-[8px] text-[13px] font-semibold rounded-[8px] transition-colors ${mode === 'withdraw' ? 'text-accent-2' : 'text-text-2 hover:text-text-1'}`} onClick={() => setMode('withdraw')}>Withdraw</button>
                  </div>
                  <motion.div className="absolute top-[4px] bottom-[4px] w-[calc(50%-4px)] bg-surface border border-bdr rounded-[8px] shadow-sm z-0" initial={false} animate={{ x: mode === 'deposit' ? 0 : '100%' }} transition={{ type: 'spring', stiffness: 400, damping: 30 }} />
                </div>

                <div className="flex items-center justify-between p-[14px_16px] mb-[20px] rounded-[14px] bg-surface-2 border border-bdr">
                  <span className="text-[13px] font-medium text-text-2 tracking-wide">
                    {mode === 'deposit' ? 'Available to deposit' : 'Available to withdraw'}
                  </span>
                  <div className="flex items-center gap-[10px]">
                    {activeDecrypt.status === 'success' && !activeHidden ? (
                      <span className="flex items-center gap-[8px] text-[17px] font-semibold text-white num tracking-tight">
                        <TokenIcon className="w-[18px] h-[18px]" />
                        {fromBaseUnits(activeDecrypt.value, decimals)}
                        <span className="text-[13px] font-medium text-text-3">{symbol}</span>
                      </span>
                    ) : isBusyDecrypting ? (
                      <Loader2 className="w-[16px] h-[16px] text-accent-2 animate-spin" />
                    ) : activeDecrypt.status === 'error' ? (
                      <span className="text-[12.5px] font-medium text-red-400">{activeDecrypt.error}</span>
                    ) : (
                      <EncryptedValue />
                    )}
                    <button onClick={handleRevealBalance} disabled={!isConnected || !isContractConfigured || (mode === 'deposit' && !isCusdtConfigured) || isBusyDecrypting} className="text-text-3 hover:text-text-1 disabled:opacity-40 transition-colors" aria-label={activeDecrypt.status === 'error' ? 'Retry' : activeDecrypt.status === 'success' && !activeHidden ? 'Hide balance' : 'Reveal balance'}>
                      {activeDecrypt.status === 'success' && !activeHidden ? <EyeOff size={14} strokeWidth={1.8} /> : <Eye size={14} strokeWidth={1.8} />}
                    </button>
                  </div>
                </div>

                <Eyebrow>Amount</Eyebrow>
                <div className="flex items-center gap-[12px] bg-[#0A0907] border border-bdr-strong rounded-[16px] p-[16px_20px] mt-[8px] shadow-inset-deep focus-within:border-accent-2/50 transition-colors">
                  <input type="text" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} className="bg-transparent border-none outline-none text-white font-d text-[36px] font-[520] w-full placeholder:text-text-3 num" />
                  <span className="flex items-center gap-[8px] bg-surface border border-bdr p-[8px_12px] rounded-full text-[14px] font-bold shrink-0 text-white shadow-sm">
                    <TokenIcon className="w-[18px] h-[18px]" />
                    {symbol}
                  </span>
                </div>

                <div className="flex gap-[10px] mt-[16px]">
                  {QUICK_AMOUNTS.map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => handleQuickAmount(preset)}
                      className="flex-1 px-[14px] py-[8px] rounded-[10px] text-[13px] font-semibold border transition-all bg-surface-2 border-bdr-strong text-text-2 hover:text-text-1 hover:bg-surface-hover disabled:opacity-50"
                      disabled={isBusyDecrypting}
                    >
                      {isBusyDecrypting && pendingPctRef.current === preset.pct ? <Loader2 className="w-[13px] h-[13px] animate-spin mx-auto" /> : preset.label}
                    </button>
                  ))}
                </div>

                {needsApproval ? (
                  <>
                    <Callout className="mt-[24px]" variant="primary">
                      One-time step: authorize Cairn to move your {symbol} before your first deposit.
                    </Callout>
                    <Button className="w-full mt-[24px] h-[52px] text-[15px]" disabled={!isConnected || !isContractConfigured || (isConnected && !isSepolia)} onClick={handleApprove}>
                      {!isConnected ? 'Connect Wallet' : `Approve CairnPool for ${symbol}`}
                    </Button>
                  </>
                ) : (
                  <>
                    <Callout className="mt-[24px]" variant="primary">
                      Your {mode} amount is encrypted before it ever leaves your browser. Not even Cairn can see the amount.
                    </Callout>
                    <Button className="w-full mt-[24px] h-[52px] text-[15px]" disabled={isSubmitting || !isConnected || !isContractConfigured || (isConnected && !isSepolia) || !amount} onClick={handleSubmit}>
                      {!isConnected ? 'Connect Wallet' : mode === 'deposit' ? `Encrypt & deposit` : `Encrypt & withdraw`}
                    </Button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {mode === 'deposit' && <GetTestTokens symbol={symbol} />}
      </div>
    </div>
  );
}
