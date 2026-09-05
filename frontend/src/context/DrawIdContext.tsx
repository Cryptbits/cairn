import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useNextDrawId } from '../hooks/useCairnReads';

/**
 * CairnPool.sol has no separate scheduling registry, but draw resolution is
 * now self-sequencing (`requestDrawResolution` returns `nextDrawId++` —
 * verified against the contract; no caller picks a drawId anymore, and
 * nobody needs to be the deployer to advance one). There's still no
 * indexer/"recent draws" feed (deliberately out of scope for this build),
 * so the frontend can't show a real list
 * of past draws. What it CAN do honestly, using only data the contract
 * already exposes: read `nextDrawId` and default to `nextDrawId - 1`, i.e.
 * whatever draw was most recently requested — the one that's actually live
 * or most recently resolved. This matters for real independent testers: a
 * wallet visiting fresh, with no shared context from whoever ran the
 * previous draw, previously always landed on the hardcoded Draw #0, which
 * is stale the moment a second draw has ever been requested. The person can
 * still type a different drawId manually (Draw screen) — doing so stops
 * the auto-sync so it doesn't fight a deliberate choice.
 */
const DrawIdContext = createContext<{ drawId: bigint; setDrawId: (id: bigint) => void; isLive: boolean; goLive: () => void } | null>(null);

export function DrawIdProvider({ children }: { children: React.ReactNode }) {
  const [drawId, setDrawIdState] = useState<bigint>(0n);
  const [isLive, setIsLive] = useState(true);
  const userOverrode = useRef(false);
  const nextDrawId = useNextDrawId();

  useEffect(() => {
    if (userOverrode.current) return;
    if (nextDrawId.data === undefined) return;
    const next = nextDrawId.data as bigint;
    setDrawIdState(next > 0n ? next - 1n : 0n);
  }, [nextDrawId.data]);

  const setDrawId = (id: bigint) => {
    userOverrode.current = true;
    setIsLive(false);
    setDrawIdState(id);
  };

  const goLive = () => {
    userOverrode.current = false;
    setIsLive(true);
    if (nextDrawId.data !== undefined) {
      const next = nextDrawId.data as bigint;
      setDrawIdState(next > 0n ? next - 1n : 0n);
    }
  };

  return <DrawIdContext.Provider value={{ drawId, setDrawId, isLive, goLive }}>{children}</DrawIdContext.Provider>;
}

export function useDrawId() {
  const ctx = useContext(DrawIdContext);
  if (!ctx) throw new Error('useDrawId must be used within DrawIdProvider');
  return ctx;
}
