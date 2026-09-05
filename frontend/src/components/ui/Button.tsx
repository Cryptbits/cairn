import React from 'react';
import { motion, HTMLMotionProps } from 'motion/react';

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'md' | 'sm';
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', fullWidth = false, children, ...props }, ref) => {
    
    const baseStyles = "inline-flex items-center justify-center gap-[8px] rounded-[12px] font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap focus-visible:outline-2 focus-visible:outline-accent-2 focus-visible:outline-offset-2 relative overflow-hidden";
    
    const variants = {
      primary: "bg-gradient-to-b from-accent-2 to-accent text-[#1B140C] shadow-[0_4px_16px_-4px_rgba(233,161,101,0.25),_inset_0_1px_1px_rgba(255,255,255,0.3)] border border-[#F2B682]/50 hover:from-[#F0B27A] hover:to-[#E0995D] hover:shadow-[0_6px_20px_-4px_rgba(233,161,101,0.3),_inset_0_1px_1px_rgba(255,255,255,0.4)]",
      secondary: "bg-[#1B1812] border border-bdr-strong text-text-1 hover:bg-[#211D16] hover:border-white/10 shadow-[0_2px_8px_rgba(0,0,0,0.4),_inset_0_1px_0_rgba(255,255,255,0.03)]",
      ghost: "bg-transparent text-text-2 hover:text-text-1 hover:bg-surface-hover"
    };

    const sizes = {
      md: "px-[20px] py-[12px] text-[14px]",
      sm: "px-[14px] py-[8px] text-[13px] rounded-[10px]"
    };

    return (
      <motion.button
        ref={ref}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.98, y: 0 }}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
        {...props}
      >
        {children}
      </motion.button>
    );
  }
);
Button.displayName = 'Button';
