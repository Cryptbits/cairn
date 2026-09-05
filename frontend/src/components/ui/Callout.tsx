import React from 'react';
import { Info } from 'lucide-react';

interface CalloutProps {
  children: React.ReactNode;
  variant?: 'primary' | 'plain';
  className?: string;
}

export function Callout({ children, variant = 'primary', className = '' }: CalloutProps) {
  const baseStyles = "flex gap-[14px] p-[16px_20px] rounded-[16px] text-[13px] leading-[1.6] shadow-sm";
  
  const variants = {
    primary: "bg-[#251910]/40 border border-accent/20 text-[#E7D8C4]",
    plain: "bg-surface-2 border border-bdr text-text-2"
  };

  return (
    <div className={`${baseStyles} ${variants[variant]} ${className}`}>
      <Info className={`w-[18px] h-[18px] shrink-0 mt-[2px] ${variant === 'primary' ? 'text-accent-2' : 'text-text-3'}`} />
      <div>{children}</div>
    </div>
  );
}
