import React from 'react';
import { motion } from 'motion/react';

interface Step {
  label: string;
}

interface StepTrackProps {
  steps: Step[];
  currentStep: number;
}

export function StepTrack({ steps, currentStep }: StepTrackProps) {
  return (
    <div className="flex items-center mt-[8px] mb-[12px] w-full max-w-[480px] mx-auto">
      {steps.map((step, index) => {
        const isDone = index + 1 < currentStep;
        const isActive = index + 1 === currentStep;
        const isLast = index === steps.length - 1;

        return (
          <div key={index} className="flex flex-col items-center gap-[10px] flex-1 relative">
            {!isLast && (
              <div className="absolute top-[6px] left-[50%] w-full h-[2px] z-[1] bg-surface-2 overflow-hidden rounded-full">
                <motion.div 
                  className="h-full bg-accent"
                  initial={{ width: '0%' }}
                  animate={{ width: isDone ? '100%' : '0%' }}
                  transition={{ duration: 0.5, ease: "easeInOut" }}
                />
              </div>
            )}
            <motion.div 
              className={`w-[14px] h-[14px] rounded-full z-[2] shadow-sm ${
                isDone ? 'bg-accent border-[3px] border-accent' : 
                isActive ? 'bg-accent-2 border-[3px] border-accent-2 shadow-[0_0_0_4px_var(--color-accent-soft)]' : 
                'bg-surface-2 border-[3px] border-bdr-strong'
              }`}
              initial={false}
              animate={{ 
                scale: isActive ? 1.2 : 1,
                backgroundColor: isDone || isActive ? 'var(--color-accent)' : 'var(--color-surface-2)' 
              }}
              transition={{ duration: 0.3 }}
            />
            <div className={`text-[11px] font-semibold text-center max-w-[90px] leading-tight ${isDone || isActive ? 'text-text-1' : 'text-text-3'}`}>
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}
