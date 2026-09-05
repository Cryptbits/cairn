import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface TokenIconProps {
  className?: string;
}

export function TokenIcon({ className = '' }: TokenIconProps) {
  return (
    <div className={`relative flex items-center justify-center shrink-0 ${className}`}>
      <img 
        src="/cusdt.png" 
        alt="cUSDT" 
        className="w-full h-full object-contain" 
      />
    </div>
  );
}
