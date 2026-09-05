import React from 'react';
import { motion, HTMLMotionProps } from 'motion/react';

interface CardProps extends HTMLMotionProps<"div"> {
  tight?: boolean;
  interactive?: boolean;
  as?: React.ElementType;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ children, className = '', tight = false, interactive = false, as: Component = motion.div, ...props }, ref) => {
    const baseStyles = "bg-surface border border-bdr rounded-[20px] shadow-[0_8px_32px_-8px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,255,255,0.03)] text-left transition-all duration-300 relative overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-b before:from-white/[0.02] before:to-transparent before:pointer-events-none";
    const paddingStyles = tight ? "p-[18px_20px]" : "p-[28px_32px]";
    const interactiveStyles = interactive ? "hover:border-white/10 cursor-pointer hover:bg-[#252119] hover:shadow-[0_12px_40px_-8px_rgba(0,0,0,0.8),_inset_0_1px_0_rgba(255,255,255,0.05)] focus-visible:outline-2 focus-visible:outline-accent-2 focus-visible:outline-offset-2" : "";

    return (
      <Component
        ref={ref}
        className={`${baseStyles} ${paddingStyles} ${interactiveStyles} ${className}`}
        whileHover={interactive ? { y: -2 } : {}}
        whileTap={interactive ? { scale: 0.99 } : {}}
        {...props}
      >
        {children}
      </Component>
    );
  }
);
Card.displayName = 'Card';

export function Eyebrow({ children, className = '' }: { children: React.ReactNode, className?: string }) {
  return (
    <span className={`block text-[11px] uppercase tracking-[0.12em] text-text-3 font-semibold mb-[8px] ${className}`}>
      {children}
    </span>
  );
}
