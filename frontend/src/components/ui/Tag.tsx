import React from 'react';

interface TagProps {
  children: React.ReactNode;
  variant?: 'encrypted' | 'public' | 'you' | 'illustrative';
  className?: string;
}

export function Tag({ children, variant = 'encrypted', className = '' }: TagProps) {
  const baseStyles = "inline-flex items-center gap-[5px] text-[10.5px] font-bold tracking-[0.04em] uppercase px-[8px] py-[4px] rounded-[8px] shadow-sm";
  
  const variants = {
    encrypted: "bg-surface-2 border border-bdr text-[#C7BCA5]",
    public: "bg-positive-soft border border-positive/20 text-positive",
    you: "bg-accent-soft border border-accent/20 text-accent-2",
    illustrative: "bg-white/[0.03] border border-white/5 text-text-3"
  };

  return (
    <span className={`${baseStyles} ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
