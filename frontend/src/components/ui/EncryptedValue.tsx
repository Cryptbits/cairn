import React from 'react';

interface EncryptedValueProps {
  className?: string;
}

export function EncryptedValue({ className = '' }: EncryptedValueProps) {
  return (
    <span className={`inline-flex items-center gap-[3px] h-[32px] ${className}`}>
      <span className="enc-bar shadow-[0_0_8px_rgba(214,138,76,0.2)]"></span>
      <span className="enc-bar shadow-[0_0_8px_rgba(214,138,76,0.2)]"></span>
      <span className="enc-bar shadow-[0_0_8px_rgba(214,138,76,0.2)]"></span>
      <span className="enc-bar shadow-[0_0_8px_rgba(214,138,76,0.2)]"></span>
      <span className="enc-bar shadow-[0_0_8px_rgba(214,138,76,0.2)]"></span>
    </span>
  );
}
