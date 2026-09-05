import React from 'react';
import { Droplet, ArrowUpRight } from 'lucide-react';


export function GetTestTokens({ symbol, context = 'deposit with' }: { symbol: string; context?: string }) {
  return (
    <div className="flex items-center gap-[12px] w-full p-[12px_16px] rounded-[14px] bg-surface-2 border border-bdr">
      <Droplet className="w-[15px] h-[15px] text-text-3 shrink-0" strokeWidth={2} />
      <span className="text-[12.5px] text-text-2 shrink-0">
        Need test {symbol}?
      </span>
      <div className="hidden sm:block h-[16px] w-px bg-bdr-strong shrink-0" />
      <div className="flex items-center gap-[8px] flex-wrap ml-auto sm:ml-0">
        <a
          href="https://sepolia.etherscan.io/address/0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0#writeContract"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-[4px] text-[12px] font-medium text-text-1 hover:text-accent-2 transition-colors"
        >
          Mint test USDT <ArrowUpRight size={11} strokeWidth={2} />
        </a>
        <span className="text-text-3 text-[12px]">&</span>
        <a
          href="https://portfolio.zama.org"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-[4px] text-[12px] font-medium text-text-1 hover:text-accent-2 transition-colors"
        >
          Shield into {symbol} (Sepolia) <ArrowUpRight size={11} strokeWidth={2} />
        </a>
      </div>
    </div>
  );
}
