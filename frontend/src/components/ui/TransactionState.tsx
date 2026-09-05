import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Check, X, Loader2 } from 'lucide-react';
import { TokenIcon } from './TokenIcon';

interface TransactionStateProps {
  status: 'processing' | 'success' | 'error';
  title: string;
  subtitle: string;
  amount?: string;
  symbol?: string;
  onDismiss?: () => void;
  errorAction?: () => void;
  errorActionLabel?: string;
  showEtherscanLink?: boolean;
  
  txHash?: `0x${string}`;
}

export function TransactionState({
  status,
  title,
  subtitle,
  amount,
  symbol,
  onDismiss,
  errorAction,
  errorActionLabel,
  showEtherscanLink,
  txHash,
}: TransactionStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-[24px_16px] text-center">
      <AnimatePresence mode="wait">
        {status === 'processing' && (
          <motion.div
            key="processing"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center"
          >
            <div className="w-[48px] h-[48px] mb-[20px] relative flex items-center justify-center">
              <div className="absolute inset-0 rounded-full border-[2px] border-white/5" />
              <motion.div 
                className="absolute inset-0 rounded-full border-[2px] border-accent-2 border-t-transparent border-r-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              />
              <div className="w-[8px] h-[8px] rounded-full bg-accent-2/80 animate-pulse" />
            </div>
            
            <h3 className="text-[16px] font-semibold text-white mb-[4px]">{title}</h3>
            <p className="text-[14px] text-text-2 mb-[24px] max-w-[260px] leading-relaxed">{subtitle}</p>

            {amount && symbol && (
              <div className="flex flex-col items-center gap-[4px] bg-[#0A0907] border border-bdr-strong rounded-[16px] p-[16px_32px] shadow-inset-deep">
                <div className="flex items-center gap-[8px] mb-[4px]">
                  <TokenIcon className="w-[18px] h-[18px]" />
                  <span className="text-[13px] font-semibold text-text-3">{symbol}</span>
                </div>
                <span className="font-d font-[520] text-[24px] text-white num">{amount}</span>
              </div>
            )}
          </motion.div>
        )}

        {status === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center w-full"
          >
            <motion.div 
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 400, damping: 30, delay: 0.1 }}
              className="w-[48px] h-[48px] mb-[20px] rounded-full bg-positive-soft border border-positive/20 flex items-center justify-center shadow-[0_0_20px_rgba(38,161,123,0.1)]"
            >
              <Check className="w-[20px] h-[20px] text-positive" strokeWidth={2.5} />
            </motion.div>
            
            <h3 className="text-[16px] font-semibold text-white mb-[4px]">{title}</h3>
            <p className="text-[14px] text-text-2 mb-[24px] max-w-[260px] leading-relaxed">{subtitle}</p>

            {showEtherscanLink && txHash && (
              <a
                href={`https://sepolia.etherscan.io/tx/${txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full max-w-[260px] py-[10px] mb-[12px] rounded-[12px] text-text-2 hover:text-white font-semibold text-[13px] hover:bg-white/5 transition-all text-center"
              >
                View transaction on Etherscan ↗
              </a>
            )}

            {onDismiss && (
              <button
                onClick={onDismiss}
                className="w-full max-w-[200px] py-[12px] rounded-[12px] bg-surface-2 border border-bdr-strong text-text-1 font-semibold text-[14px] hover:bg-surface-hover hover:border-white/10 transition-all shadow-elevation-1"
              >
                Done
              </button>
            )}
          </motion.div>
        )}

        {status === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center w-full"
          >
            <div className="w-[48px] h-[48px] mb-[20px] rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
              <X className="w-[20px] h-[20px] text-red-400" strokeWidth={2.5} />
            </div>
            
            <h3 className="text-[16px] font-semibold text-white mb-[4px]">{title}</h3>
            <p className="text-[14px] text-text-2 mb-[32px] max-w-[260px] leading-relaxed">{subtitle}</p>

            {errorAction && (
              <button
                onClick={errorAction}
                className="w-full max-w-[200px] py-[12px] rounded-[12px] bg-surface-2 border border-bdr-strong text-text-1 font-semibold text-[14px] hover:bg-surface-hover hover:border-white/10 transition-all shadow-elevation-1"
              >
                {errorActionLabel || 'Try again'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
