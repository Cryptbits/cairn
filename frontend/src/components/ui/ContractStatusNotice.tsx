import React from 'react';
import { Callout } from './Callout';

export function NotDeployedNotice({ className = '' }: { className?: string }) {
  return (
    <Callout variant="plain" className={className}>
      Cairn isn't connected to a live pool right now, so there's nothing to read or act on here yet.
    </Callout>
  );
}

export function WrongNetworkNotice({
  onSwitch,
  isSwitching,
  className = '',
}: {
  onSwitch: () => void;
  isSwitching: boolean;
  className?: string;
}) {
  return (
    <Callout variant="plain" className={className}>
      Your wallet is connected to the wrong network. Cairn runs on Sepolia.{' '}
      <button onClick={onSwitch} disabled={isSwitching} className="text-accent-2 font-semibold underline underline-offset-2 disabled:opacity-50">
        {isSwitching ? 'Switching…' : 'Switch to Sepolia'}
      </button>
    </Callout>
  );
}
