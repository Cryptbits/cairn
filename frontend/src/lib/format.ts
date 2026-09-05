export function shortAddr(addr?: string | null): string {
  if (!addr) return '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

/**
 * cUSDT's real decimals (recommended 6 per the IERC7984 interface, read
 * live from the token via `decimals()` — see hooks/useCairnReads.ts's
 * `useCusdtDecimals`). All amounts moved through CairnPool (deposit,
 * withdraw, claim credit) are in this same base unit, since principal and
 * prize are both denominated in the same custodied cUSDT.
 */
export function toBaseUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!trimmed || Number.isNaN(Number(trimmed))) return 0n;
  const [whole, frac = ''] = trimmed.split('.');
  const paddedFrac = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const combined = `${whole || '0'}${paddedFrac}`.replace(/^0+(?=\d)/, '');
  try {
    return BigInt(combined || '0');
  } catch {
    return 0n;
  }
}

export function fromBaseUnits(amount: bigint | null | undefined, decimals: number): string {
  if (amount === null || amount === undefined) return '—';
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const frac = decimals > 0 ? s.slice(s.length - decimals).replace(/0+$/, '') : '';
  const result = frac ? `${whole}.${frac}` : whole;
  return negative ? `-${result}` : result;
}

/** Plain integer display for values with no decimals concept (e.g. counts). */
export function formatAmount(value: bigint | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('en-US');
}

/**
 * The deployed Sepolia test token's real on-chain `symbol()` is
 * "cUSDTMock" — accurate, but reads as a typo/bug when it shows up
 * concatenated into UI copy ("10.0 cUSDTMock", "cUSDTMockMax…"). This
 * strips the "Mock"/"Test" suffix for *display* only; nothing that reads
 * on-chain data or builds transactions uses this — only label text.
 */
export function displaySymbol(rawSymbol: string | undefined): string {
  if (!rawSymbol) return 'cUSDT';
  const cleaned = rawSymbol.replace(/\s*(mock|test)\s*$/i, '').trim();
  return cleaned || 'cUSDT';
}
