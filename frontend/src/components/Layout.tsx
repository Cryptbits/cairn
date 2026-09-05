import React from 'react';
import { ViewType } from '../types';
import { Home, ArrowDownCircle, Trophy, CheckCircle2, Shield, Wrench } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useAccount } from 'wagmi';
import { WalletHeader } from './layout/WalletHeader';
import { useOwner } from '../hooks/useCairnReads';

interface LayoutProps {
  currentView: ViewType;
  setCurrentView: (v: ViewType) => void;
  children: React.ReactNode;
}

export function Layout({ currentView, setCurrentView, children }: LayoutProps) {

  const { address } = useAccount();
  const ownerRead = useOwner();
  const isOwner = typeof ownerRead.data === 'string' && !!address && ownerRead.data.toLowerCase() === address.toLowerCase();

  if (currentView === 'landing') {
    return <div className="w-full min-h-screen bg-[radial-gradient(1100px_600px_at_50%_0%,_rgba(214,138,76,0.08),_transparent_60%),_var(--color-bg)]">{children}</div>;
  }

  type NavItem = {
    id: ViewType;
    label: string;
    icon: typeof Home;
    mobileLabel?: string;
    groupLabel?: string;
  };

  const navItems: NavItem[] = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'deposit', label: 'Deposit / Withdraw', mobileLabel: 'Deposit', icon: ArrowDownCircle },
    { id: 'draw', label: 'Draw', icon: Trophy },
    { id: 'result', label: 'Claim', icon: CheckCircle2 },
    { id: 'privacy', label: 'Privacy Center', mobileLabel: 'More', icon: Shield, groupLabel: 'Learn' },
    ...(isOwner ? [{ id: 'admin' as ViewType, label: 'Fund yield source', icon: Wrench, groupLabel: 'Owner tools' }] : []),
  ];

  const mobileNavItems = ['home', 'deposit', 'draw', 'privacy'];

  return (
    <div className="flex justify-center p-[env(safe-area-inset-top,0px)_0_0] md:p-[32px_24px_48px] min-h-screen bg-[radial-gradient(1200px_600px_at_50%_-10%,_rgba(214,138,76,0.06),_transparent_60%),_#0c0b08]">
      <div className="w-full max-w-[1240px] bg-bg md:rounded-[24px] shadow-elevation-2 border-0 md:border md:border-white/[0.04] flex flex-col md:flex-row min-h-screen md:min-h-[760px] overflow-hidden relative">
        
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-[260px] shrink-0 bg-[#12100C] border-r border-bdr p-[28px_20px] gap-[32px] z-10 relative">
          <button
            onClick={() => setCurrentView('landing')}
            className="flex items-center gap-[12px] p-[0_8px] outline-none focus-visible:ring-2 ring-accent/50 rounded-[8px] w-fit"
            aria-label="Go to Welcome page"
          >
            <svg className="w-[28px] h-[24px] shrink-0 self-center drop-shadow-md" viewBox="0 0 26 22" fill="none"><rect x="2" y="16" width="22" height="5" rx="2.2" fill="#5C5646"/><rect x="5.5" y="9" width="15" height="5" rx="2.2" fill="#8B6A45"/><rect x="9" y="2" width="8" height="5" rx="2.2" fill="#E9A165"/></svg>
            <span className="font-d text-[22px] font-[560] tracking-[0.01em] text-text-1 leading-none self-center">Cairn</span>
          </button>
          
          <nav className="flex flex-col gap-[4px]">
            {navItems.map((item) => {
              const isActive = currentView === item.id || (currentView === 'claim' && item.id === 'result');
              return (
                <React.Fragment key={item.id}>
                  {item.groupLabel && (
                    <div className="text-[11px] uppercase tracking-[0.15em] text-text-3 font-semibold p-[12px_12px_4px] mt-[8px]">
                      {item.groupLabel}
                    </div>
                  )}
                  <button
                    onClick={() => setCurrentView(item.id as ViewType)}
                    className={`flex items-center gap-[12px] p-[10px_12px] rounded-[12px] text-[14px] font-medium w-full text-left transition-all relative outline-none focus-visible:ring-2 ring-accent/50 ${isActive ? 'text-text-1 bg-surface-hover shadow-sm' : 'text-text-2 hover:bg-surface hover:text-text-1'}`}
                  >
                    {isActive && (
                      <motion.div 
                        layoutId="nav-indicator"
                        className="absolute left-[4px] top-[20%] bottom-[20%] w-[3px] bg-accent-2 rounded-full"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2 }}
                      />
                    )}
                    <item.icon className={`w-[18px] h-[18px] shrink-0 ${isActive ? 'text-accent-2' : 'opacity-80'}`} strokeWidth={1.8} />
                    {item.label}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 flex flex-col relative bg-bg h-auto md:h-full overflow-y-auto hide-scrollbar">
          {/* Global Header */}
          <header className="flex-shrink-0 w-full flex items-center justify-end p-[16px_24px] md:p-[24px_32px] z-50">
            <WalletHeader />
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              className="flex-1 flex flex-col"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Mobile Bottom Tabbar */}
        <nav className="md:hidden sticky bottom-0 z-20 flex justify-around p-[10px_8px_calc(10px+env(safe-area-inset-bottom,0px))] bg-[#12100C]/80 backdrop-blur-xl border-t border-bdr-strong mt-auto">
          {navItems.filter(i => mobileNavItems.includes(i.id)).map(item => {
            const isActive = currentView === item.id || (currentView === 'claim' && item.id === 'result');
            return (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id as ViewType)}
                className={`flex flex-col items-center gap-[4px] p-[6px_10px] rounded-[12px] text-[10px] font-semibold transition-colors ${isActive ? 'text-accent-2' : 'text-text-3 hover:text-text-2'}`}
              >
                <item.icon className="w-[20px] h-[20px]" strokeWidth={isActive ? 2.2 : 1.8} />
                {item.mobileLabel || item.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
