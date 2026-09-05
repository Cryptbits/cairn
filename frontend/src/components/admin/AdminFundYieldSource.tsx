import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useAccount } from 'wagmi';
import { Card, Eyebrow } from '../ui/Card';
import { Callout } from '../ui/Callout';
import { Button } from '../ui/Button';
import { TransactionState } from '../ui/TransactionState';
import { TokenIcon } from '../ui/TokenIcon';
import { NotDeployedNotice, WrongNetworkNotice } from '../ui/ContractStatusNotice';
import { GetTestTokens } from '../ui/GetTestTokens';
import { isContractConfigured, isCusdtConfigured, CUSDT_ADDRESS } from '../../config/contracts';
import { useNetworkGuard } from '../../hooks/useNetworkGuard';
import { useApproveOperatorAction, useFundYieldSourceAction } from '../../hooks/useCairnActions';
import { useCusdtDecimals, useCusdtSymbol, useIsPoolOperator, useOwner } from '../../hooks/useCairnReads';
import { toBaseUnits, displaySymbol, shortAddr } from '../../lib/format';

export function AdminFundYieldSource() {
  const { isConnected } = useAccount();
  const { isSepolia, switchToSepolia, isSwitching } = useNetworkGuard();
  const [amount, setAmount] = useState('');

  const decimalsRead = useCusdtDecimals();
  const symbolRead = useCusdtSymbol();
  const decimals = typeof decimalsRead.data === 'number' ? decimalsRead.data : 6;
  const symbol = displaySymbol(typeof symbolRead.data === 'string' ? symbolRead.data : undefined);

  const ownerRead = useOwner();
  const { address } = useAccount();
  const isOwner = typeof ownerRead.data === 'string' && !!address && ownerRead.data.toLowerCase() === address.toLowerCase();
  const isOperator = useIsPoolOperator();

  const approveAction = useApproveOperatorAction();
  const fundAction = useFundYieldSourceAction();

  const needsApproval = isCusdtConfigured && isOperator.data === false;
  const isApproving = approveAction.status !== 'idle';
  const isFunding = fundAction.status !== 'idle';

  const prevApproveStatus = useRef(approveAction.status);
  useEffect(() => {
    if (prevApproveStatus.current !== 'success' && approveAction.status === 'success') {
      isOperator.refetch();
    }
    prevApproveStatus.current = approveAction.status;
  }, [approveAction.status]);

  const handleFund = () => {
    const parsed = toBaseUnits(amount, decimals);
    if (parsed <= 0n) return;
    fundAction.run(parsed);
  };

  const fundStatusMode = fundAction.status === 'success' ? 'success' : fundAction.status === 'rejected' || fundAction.status === 'failed' ? 'error' : 'processing';

  const fundTitle =
    fundAction.status === 'success'
      ? 'Prize reserve funded'
      : fundAction.status === 'rejected'
        ? 'Wallet rejected the request'
        : fundAction.status === 'failed'
          ? 'Funding failed'
          : fundAction.status === 'preparing'
            ? 'Encrypting the amount'
            : fundAction.status === 'signing'
              ? 'Awaiting wallet signature'
              : fundAction.status === 'submitting'
                ? 'Submitting transaction'
                : 'Confirming on chain';

  const fundSubtitle =
    fundAction.status === 'success'
      ? `Real ${symbol} moved into CairnPool's encrypted prize reserve. Future draws can use the funded reserve for prizes.`
      : fundAction.status === 'failed' || fundAction.status === 'rejected'
        ? fundAction.error ?? 'Try again.'
        : `Building the encrypted transfer via the Zama relayer…`;

  return (
    <div className="flex flex-col w-full h-full pb-8 items-center">
      <div className="flex items-center justify-between p-[8px_24px_0] md:p-[8px_40px_0] w-full max-w-[640px]">
        <div>
          <h1 className="text-[28px] md:text-[32px] text-white">Fund prize reserve</h1>
          <div className="text-text-2 text-[14px] mt-[4px]">
            Add test cUSDT to the encrypted reserve used to fund future prizes.
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] p-[20px_24px_40px] md:p-[32px_40px_56px] w-full max-w-[640px]">
        {!isContractConfigured && <NotDeployedNotice />}
        {isContractConfigured && isConnected && !isSepolia && <WrongNetworkNotice onSwitch={switchToSepolia} isSwitching={isSwitching} />}
        {isContractConfigured && !isCusdtConfigured && (
          <Callout variant="plain">Cairn isn't connected to {symbol} right now, so funding isn't available yet.</Callout>
        )}
        {isContractConfigured && isConnected && ownerRead.data !== undefined && !isOwner && (
          <Callout variant="plain">
            This wallet isn't CairnPool's owner. Only <span className="text-text-1">{shortAddr(ownerRead.data as string)}</span> can fund the
            prize reserve. Connect that wallet instead.
          </Callout>
        )}

        <Card className="bg-[#12100C] overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            {isApproving || isFunding ? (
              <motion.div key="transaction" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }} className="py-[24px]">
                {isApproving ? (
                  <TransactionState
                    status={approveAction.status === 'success' ? 'success' : approveAction.status === 'rejected' || approveAction.status === 'failed' ? 'error' : 'processing'}
                    title={approveAction.status === 'success' ? 'CairnPool approved' : approveAction.status === 'rejected' ? 'Wallet rejected the request' : approveAction.status === 'failed' ? 'Approval failed' : 'Approving CairnPool as operator'}
                    subtitle={
                      approveAction.status === 'success'
                        ? `CairnPool can now move this wallet's ${symbol}, for the next 30 days.`
                        : (approveAction.error ?? `Authorizing CairnPool to move this wallet's ${symbol}, like an ERC-20 approve.`)
                    }
                    onDismiss={() => approveAction.reset()}
                    errorAction={() => approveAction.reset()}
                  />
                ) : (
                  <TransactionState
                    status={fundStatusMode}
                    title={fundTitle}
                    subtitle={fundSubtitle}
                    amount={amount || '0'}
                    symbol={symbol}
                    onDismiss={() => fundAction.reset()}
                    errorAction={() => fundAction.reset()}
                    showEtherscanLink={fundAction.status === 'success'}
                    txHash={fundAction.txHash}
                  />
                )}
              </motion.div>
            ) : (
              <motion.div key="form" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
                <Eyebrow>Amount to seed</Eyebrow>
                <div className="flex items-center gap-[12px] bg-[#0A0907] border border-bdr-strong rounded-[16px] p-[16px_20px] mt-[8px] shadow-inset-deep focus-within:border-accent-2/50 transition-colors">
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="bg-transparent border-none outline-none text-white font-d text-[36px] font-[520] w-full placeholder:text-text-3 num"
                  />
                  <span className="flex items-center gap-[8px] bg-surface border border-bdr p-[8px_12px] rounded-full text-[14px] font-bold shrink-0 text-white shadow-sm">
                    <TokenIcon className="w-[18px] h-[18px]" />
                    {symbol}
                  </span>
                </div>

                {needsApproval ? (
                  <>
                    <Callout className="mt-[24px]" variant="primary">
                      One-time step: authorize CairnPool to move this wallet's {symbol} before seeding the reserve.
                    </Callout>
                    <Button
                      className="w-full mt-[24px] h-[52px] text-[15px]"
                      disabled={!isConnected || !isContractConfigured || (isConnected && !isSepolia)}
                      onClick={() => approveAction.run(30)}
                    >
                      {!isConnected ? 'Connect wallet' : `Approve CairnPool for ${symbol}`}
                    </Button>
                  </>
                ) : (
                  <>
                    <Callout className="mt-[24px]" variant="primary">
                      This amount is encrypted before it ever leaves this browser, the same as a deposit, even though it's the prize
                      reserve and not a user's principal.
                    </Callout>
                    <Button
                      className="w-full mt-[24px] h-[52px] text-[15px]"
                      disabled={!isConnected || !isContractConfigured || (isConnected && !isSepolia) || !amount}
                      onClick={handleFund}
                    >
                      {!isConnected ? 'Connect wallet' : 'Encrypt & fund reserve'}
                    </Button>
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        <GetTestTokens symbol={symbol} context="fund the reserve with" />
      </div>
    </div>
  );
}
