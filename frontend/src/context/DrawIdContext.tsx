import React, { createContext, useContext, useState } from 'react';
import { useNextDrawId } from '../hooks/useCairnReads';

const DrawIdContext = createContext<{ drawId: bigint; setDrawId: (id: bigint) => void; isLive: boolean; goLive: () => void } | null>(null);

export function DrawIdProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = useState<bigint | null>(null);
  const [isLive, setIsLive] = useState(true);
  const nextDrawId = useNextDrawId();

  const next = nextDrawId.data as bigint | undefined;
  const live = next !== undefined && next > 0n ? next - 1n : 0n;
  const drawId = override ?? live;

  const setDrawId = (id: bigint) => {
    setIsLive(false);
    setOverride(id);
  };

  const goLive = () => {
    setIsLive(true);
    setOverride(null);
  };

  return <DrawIdContext.Provider value={{ drawId, setDrawId, isLive, goLive }}>{children}</DrawIdContext.Provider>;
}

export function useDrawId() {
  const ctx = useContext(DrawIdContext);
  if (!ctx) throw new Error('useDrawId must be used within DrawIdProvider');
  return ctx;
}