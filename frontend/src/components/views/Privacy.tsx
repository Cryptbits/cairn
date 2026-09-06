import React from 'react';
import { Card, Eyebrow } from '../ui/Card';
import { Lock, FileKey, Shield } from 'lucide-react';
import { useYieldRateBps } from '../../hooks/useCairnReads';

export function Privacy() {
  const yieldRate = useYieldRateBps();
  const yieldRatePct = typeof yieldRate.data === 'number' ? (yieldRate.data / 100).toFixed(1) : null;

  return (
    <div className="flex flex-col w-full h-full pb-8 items-center">
      <div className="flex items-center justify-between p-[8px_24px_0] md:p-[8px_40px_0] w-full max-w-[760px]">
        <div>
          <h1 className="text-[28px] md:text-[32px] text-white">Privacy Center</h1>
          <div className="text-text-2 text-[14px] mt-[4px]">How Cairn protects your data via FHE</div>
        </div>
      </div>

      <div className="flex flex-col gap-[20px] md:gap-[24px] p-[20px_24px_40px] md:p-[32px_40px_56px] w-full max-w-[760px]">
        
        <Card className="bg-[#12100C] divide-y divide-bdr p-0 overflow-hidden">
          {[
            { icon: Lock, title: 'Encrypted balances', body: 'Your principal and prize are held as encrypted values. The contract does not expose your individual balance as plaintext to the contract owner.' },
            { icon: Shield, title: 'Encrypted computation', body: 'Draw resolution performs arithmetic over encrypted values. Individual balances are never exposed as plaintext to the contract.' },
            { icon: FileKey, title: 'User decryption', body: "When you request a private value, Zama's user-decryption flow makes the authorized plaintext available to your client. The plaintext is not written on-chain." },
          ].map(({ icon: Icon, title, body }, i) => (
            <div key={i} className="flex items-start gap-[16px] p-[20px_24px]">
              <div className="w-[36px] h-[36px] shrink-0 rounded-[10px] bg-surface border border-bdr-strong flex items-center justify-center mt-[1px]">
                <Icon size={16} className="text-text-2" strokeWidth={1.8} />
              </div>
              <div>
                <div className="text-[14px] font-semibold text-text-1 mb-[3px]">{title}</div>
                <div className="text-[13px] text-text-2 leading-relaxed">{body}</div>
              </div>
            </div>
          ))}
        </Card>

        <Card className="bg-[#12100C]">
          <Eyebrow>What's private, what's public</Eyebrow>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px] mt-[24px]">
            <div className="flex flex-col gap-[12px] p-[20px] bg-surface-2 rounded-[16px] border border-bdr shadow-inset-deep">
              <div className="flex items-center gap-[8px] text-text-2 mb-[8px]">
                <Lock size={16} strokeWidth={2} />
                <span className="text-[11px] font-bold uppercase tracking-wider">Private (Encrypted)</span>
              </div>
              {[
                'Individual deposit amounts',
                'Individual balances',
                'Individual position used to determine draw odds',
                'The encrypted prize before the winner decrypts it',
              ].map((item, i) => (
                <div key={i} className="text-[13.5px] font-medium text-text-2 pl-[8px] border-l-[2px] border-text-3/20">
                  {item}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-[12px] p-[20px] bg-surface-2 rounded-[16px] border border-bdr shadow-inset-deep">
              <div className="flex items-center gap-[8px] text-positive mb-[8px]">
                <Shield size={16} strokeWidth={2} />
                <span className="text-[11px] font-bold uppercase tracking-wider">Public (Plaintext)</span>
              </div>
              {[
                'Draw ID, stage, and cohort size',
                'Participant count',
                'Verified total draw weight (aggregate)',
                'Protocol parameters (configured rate, min cohort)',
                'Winning address (post-draw)',
              ].map((item, i) => (
                <div key={i} className="text-[13.5px] font-medium text-text-1 pl-[8px] border-l-[2px] border-positive/30">
                  {item}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-[12px] p-[20px] bg-accent-soft rounded-[16px] border border-accent/20 shadow-inset-deep relative overflow-hidden">
              <div className="absolute top-0 right-0 w-[120px] h-[120px] bg-accent/10 blur-[40px] rounded-full pointer-events-none" />
              <div className="flex items-center gap-[8px] text-accent-2 mb-[8px] relative z-10">
                <FileKey size={16} strokeWidth={2} />
                <span className="text-[11px] font-bold uppercase tracking-wider">User Decrypted</span>
              </div>
              {[
                'Your principal, after you request decryption',
                'Your prize, after you request decryption',
              ].map((item, i) => (
                <div key={i} className="text-[13.5px] font-medium text-text-1 pl-[8px] border-l-[2px] border-accent/40 relative z-10">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <hr className="h-[1px] bg-bdr-strong border-none my-[28px]" />

          <Eyebrow>How a draw resolves</Eyebrow>
          <p className="text-[13.5px] text-text-2 leading-relaxed mt-[12px] max-w-[600px]">
            Cairn runs on Zama's FHEVM, so the contract computes directly over encrypted values. It never needs to decrypt anyone's
            balance to total up weight or pick a winner. Advancing a round is automated by a keeper bot, and the same on-chain functions stay permissionless as a documented fallback — no saver is ever asked to pay gas advancing a draw on everyone else's behalf. Only the winning address becomes public once a round resolves.
          </p>

          <div className="flex flex-col gap-[10px] mt-[20px]">
            {[
              { n: 1, title: 'Everyone marks ready', body: 'Each saver in the round confirms they\'re ready. The round only starts once all of them have.' },
              { n: 2, title: 'Total weight is verified', body: 'The combined encrypted weight of every saver in the round is confirmed on chain, still without revealing any individual balance.' },
              { n: 3, title: 'A winner is drawn and revealed', body: 'FHE randomness selects a winner over the encrypted weights. Only that address becomes public.' },
            ].map((step) => (
              <div key={step.n} className="flex items-start gap-[14px] p-[14px_16px] rounded-[14px] bg-surface-2 border border-bdr">
                <div className="w-[24px] h-[24px] shrink-0 rounded-full bg-surface border border-bdr-strong flex items-center justify-center text-[12px] font-bold text-accent-2 mt-[1px]">
                  {step.n}
                </div>
                <div>
                  <div className="text-[13.5px] font-semibold text-text-1">{step.title}</div>
                  <div className="text-[12.5px] text-text-2 mt-[2px] leading-relaxed">{step.body}</div>
                </div>
              </div>
            ))}
          </div>

          <hr className="h-[1px] bg-bdr-strong border-none my-[28px]" />

          <Eyebrow>Where the prize comes from</Eyebrow>
          <div className="flex flex-col md:flex-row items-stretch gap-[16px] mt-[16px]">
            <div className="flex flex-col items-center justify-center text-center p-[24px] rounded-[16px] bg-surface-2 border border-bdr shadow-inset-deep md:w-[200px] shrink-0">
              <span className="font-d text-[36px] font-[560] num text-white">{yieldRatePct !== null ? `${yieldRatePct}%` : '–'}</span>
              <span className="text-[11px] font-semibold tracking-wider text-text-2 mt-[6px] uppercase">Of verified weight</span>
            </div>
            <p className="text-[13.5px] text-text-2 leading-relaxed flex-1">
              Each round's prize is computed automatically from that percentage of the round's real, verified total draw weight, paid
              out of a reserve the contract owner funds ahead of time. No one decides a prize by hand round to round, and a draw can never pay out more than what's actually funded.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
