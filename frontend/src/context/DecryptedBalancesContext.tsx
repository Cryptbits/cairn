import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { callFhevm } from '../config/zama';
import { CAIRN_POOL_ADDRESS } from '../config/contracts';

/**
 * FIX: previously every screen called its own private `useDecryptHandle()`
 * instance (Home and Deposit each had a separate `useState`). Decrypting
 * your principal on Home told the relayer and got a real signature, but that
 * result lived only in Home's local state — navigating away and back threw
 * it away and made you sign the exact same EIP-712 request again for the
 * exact same handle. That's not a privacy requirement (the signature only
 * proves you're the owner; it doesn't need to be re-proven every
 * navigation) — it was just state that was never shared. This context is
 * the fix: one decrypted-value cache per ciphertext *handle*, shared across
 * every screen.
 *
 * Cache key is the handle itself (not "principal" as a label), so it
 * self-invalidates for free: once a deposit/withdraw/claim tx changes a
 * value on-chain, the contract returns a NEW handle, the cache misses on
 * that new key, and the UI correctly falls back to encrypted/"Reveal" again
 * — it never shows a stale decrypted number after a real balance change.
 */
export type DecryptStatus = 'idle' | 'preparing' | 'signing' | 'decrypting' | 'success' | 'error' | 'unauthorized';

interface Entry {
  status: DecryptStatus;
  value: bigint | null;
  error: string | null;
}

const ZERO_HANDLE_RE = /^0x0+$/;

/**
 * Turns any decrypt failure into one short, fixed, user-facing sentence.
 * Never returns raw SDK / WASM / Rust text — that goes to console.error
 * only. The relayer SDK sometimes wraps the real error behind a generic
 * "An error occured during decryption" message with the actual cause one
 * level down in `err.cause`, so we walk the chain before classifying.
 */
function classifyDecryptError(err: any): string {
  const parts: string[] = [];
  let cur = err;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.shortMessage) parts.push(String(cur.shortMessage));
    if (cur.message) parts.push(String(cur.message));
    cur = cur.cause;
  }
  const message = parts.join(' | ');

  if (/reject|denied|user rejected/i.test(message)) {
    return 'You declined the signature request.';
  }
  if (/acl|permission|not authorized|unauthorized/i.test(message)) {
    return 'Not authorized to decrypt this value.';
  }
  if (/rpc request failed|http request failed|free plan|rate limit|429|too many requests|upgrade to a paid|-32005|-32603/i.test(message)) {
    return 'The Sepolia network is being unreliable right now. Try again in a moment.';
  }
  if (/expired|timestamp|signature.*(valid|window)/i.test(message)) {
    return 'Your signature expired. Try revealing again.';
  }
  if (/reconstruct|threshold|kms|coprocessor/i.test(message)) {
    return "Zama's decryption network is having a temporary issue. Try again in a moment.";
  }
  // Deliberately generic and short — never interpolate the raw message
  // here, since that's exactly how Rust/WASM stack traces used to leak
  // into the UI.
  return "Couldn't reveal this value right now. Try again.";
}
const IDLE: Entry = { status: 'idle', value: null, error: null };

const DecryptedBalancesContext = createContext<{
  get: (handle: `0x${string}` | undefined | null) => Entry;
  decrypt: (handle: `0x${string}` | undefined | null, contractAddress?: string) => Promise<void>;
  decryptMany: (handles: (`0x${string}` | undefined | null)[], contractAddress?: string) => Promise<void>;
  clear: (handle: `0x${string}` | undefined | null) => void;
} | null>(null);

export function DecryptedBalancesProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [entries, setEntries] = useState<Record<string, Entry>>({});
  const inFlight = useRef<Set<string>>(new Set());

  const get = useCallback((handle: `0x${string}` | undefined | null) => (handle ? (entries[handle] ?? IDLE) : IDLE), [entries]);

  const clear = useCallback((handle: `0x${string}` | undefined | null) => {
    if (!handle) return;
    setEntries((e) => {
      const next = { ...e };
      delete next[handle];
      return next;
    });
  }, []);

  const decrypt = useCallback(
    async (handle: `0x${string}` | undefined | null, contractAddress: string = CAIRN_POOL_ADDRESS as string) => {
      if (!address || !handle) return;
      if (inFlight.current.has(handle)) return; // two screens reader the same handle at once — don't double-sign
      if (entries[handle]?.status === 'success') return; // already decrypted, nothing to do

      if (ZERO_HANDLE_RE.test(handle)) {
        setEntries((e) => ({ ...e, [handle]: { status: 'success', value: 0n, error: null } }));
        return;
      }

      inFlight.current.add(handle);
      setEntries((e) => ({ ...e, [handle]: { status: 'preparing', value: null, error: null } }));
      try {
        const contractAddresses = [contractAddress];
        const startTimestamp = Math.floor(Date.now() / 1000);
        const durationDays = 1;
        const { keypair, eip712 } = await callFhevm(async (instance) => {
          const kp = instance.generateKeypair();
          const domain = instance.createEIP712(kp.publicKey, contractAddresses, startTimestamp, durationDays);
          return { keypair: kp, eip712: domain };
        });

        setEntries((e) => ({ ...e, [handle]: { ...e[handle], status: 'signing', value: null, error: null } }));
        const signature = await signTypedDataAsync({
          domain: eip712.domain as any,
          types: eip712.types as any,
          primaryType: eip712.primaryType as any,
          message: eip712.message as any,
          account: address as `0x${string}`,
        });

        setEntries((e) => ({ ...e, [handle]: { ...e[handle], status: 'decrypting', value: null, error: null } }));
        const result = await callFhevm((instance) =>
          instance.userDecrypt(
            [{ handle, contractAddress }],
            keypair.privateKey,
            keypair.publicKey,
            signature,
            contractAddresses,
            address,
            startTimestamp,
            durationDays,
          ),
        );

        const clearVal = result[handle];
        if (clearVal === undefined) {
          setEntries((e) => ({ ...e, [handle]: { status: 'unauthorized', value: null, error: 'Not authorized to decrypt this value.' } }));
          return;
        }
        const value = typeof clearVal === 'bigint' ? clearVal : BigInt(clearVal as any);
        setEntries((e) => ({ ...e, [handle]: { status: 'success', value, error: null } }));
      } catch (err: any) {
        console.error('[decrypt]', handle, err);
        setEntries((e) => ({ ...e, [handle]: { status: 'error', value: null, error: classifyDecryptError(err) } }));
      } finally {
        inFlight.current.delete(handle);
      }
    },
    [address, signTypedDataAsync, entries],
  );

  /**
   * Reveals several handles (e.g. principal + draw weight) behind a single
   * wallet signature and a single relayer round trip, instead of one
   * signature per value. `instance.userDecrypt` already accepts a list of
   * `{ handle, contractAddress }` pairs — this was previously only ever
   * called with one entry, which is what forced "Reveal" on Home and the
   * separate eye icon on the Draw weight tile to be two independent
   * decrypt flows (two signatures) for values that always belong together.
   */
  const decryptMany = useCallback(
    async (rawHandles: (`0x${string}` | undefined | null)[], contractAddress: string = CAIRN_POOL_ADDRESS as string) => {
      const handles = Array.from(new Set(rawHandles.filter((h): h is `0x${string}` => !!h)));
      if (!address || handles.length === 0) return;

      const zero = handles.filter((h) => ZERO_HANDLE_RE.test(h));
      const live = handles.filter((h) => !ZERO_HANDLE_RE.test(h) && entries[h]?.status !== 'success' && !inFlight.current.has(h));

      if (zero.length) {
        setEntries((e) => {
          const next = { ...e };
          for (const h of zero) next[h] = { status: 'success', value: 0n, error: null };
          return next;
        });
      }
      if (live.length === 0) return;

      for (const h of live) inFlight.current.add(h);
      setEntries((e) => {
        const next = { ...e };
        for (const h of live) next[h] = { status: 'preparing', value: null, error: null };
        return next;
      });

      try {
        const contractAddresses = [contractAddress];
        const startTimestamp = Math.floor(Date.now() / 1000);
        const durationDays = 1;
        const { keypair, eip712 } = await callFhevm(async (instance) => {
          const kp = instance.generateKeypair();
          const domain = instance.createEIP712(kp.publicKey, contractAddresses, startTimestamp, durationDays);
          return { keypair: kp, eip712: domain };
        });

        setEntries((e) => {
          const next = { ...e };
          for (const h of live) next[h] = { ...next[h], status: 'signing', value: null, error: null };
          return next;
        });
        const signature = await signTypedDataAsync({
          domain: eip712.domain as any,
          types: eip712.types as any,
          primaryType: eip712.primaryType as any,
          message: eip712.message as any,
          account: address as `0x${string}`,
        });

        setEntries((e) => {
          const next = { ...e };
          for (const h of live) next[h] = { ...next[h], status: 'decrypting', value: null, error: null };
          return next;
        });
        const result = await callFhevm((instance) =>
          instance.userDecrypt(
            live.map((handle) => ({ handle, contractAddress })),
            keypair.privateKey,
            keypair.publicKey,
            signature,
            contractAddresses,
            address,
            startTimestamp,
            durationDays,
          ),
        );

        setEntries((e) => {
          const next = { ...e };
          for (const h of live) {
            const clearVal = result[h];
            if (clearVal === undefined) {
              next[h] = { status: 'unauthorized', value: null, error: 'Not authorized to decrypt this value.' };
            } else {
              const value = typeof clearVal === 'bigint' ? clearVal : BigInt(clearVal as any);
              next[h] = { status: 'success', value, error: null };
            }
          }
          return next;
        });
      } catch (err: any) {
        console.error('[decrypt:batch]', handles, err);
        const errEntry: Entry = { status: 'error', value: null, error: classifyDecryptError(err) };
        setEntries((e) => {
          const next = { ...e };
          for (const h of live) next[h] = errEntry;
          return next;
        });
      } finally {
        for (const h of live) inFlight.current.delete(h);
      }
    },
    [address, signTypedDataAsync, entries],
  );

  return <DecryptedBalancesContext.Provider value={{ get, decrypt, decryptMany, clear }}>{children}</DecryptedBalancesContext.Provider>;
}

/** Drop-in replacement for the old per-screen `useDecryptHandle` — same shape, shared cache underneath. */
export function useSharedDecrypt(handle: `0x${string}` | undefined | null, contractAddress?: string) {
  const ctx = useContext(DecryptedBalancesContext);
  if (!ctx) throw new Error('useSharedDecrypt must be used within DecryptedBalancesProvider');
  const entry = ctx.get(handle);
  const decrypt = useCallback(() => ctx.decrypt(handle, contractAddress), [ctx, handle, contractAddress]);
  const reset = useCallback(() => ctx.clear(handle), [ctx, handle]);
  return { ...entry, decrypt, reset };
}

/**
 * Reveals a *group* of handles (e.g. principal + draw weight) as one unit,
 * behind a single signature. `status`/`value` below describe the primary
 * handle (first in the list) so an existing single-value UI can drive off
 * it unchanged; `decrypt()` requests every handle in the group at once and
 * `allSuccess` tells you when the whole group is actually revealed.
 */
export function useSharedDecryptGroup(handles: (`0x${string}` | undefined | null)[], contractAddress?: string) {
  const ctx = useContext(DecryptedBalancesContext);
  if (!ctx) throw new Error('useSharedDecryptGroup must be used within DecryptedBalancesProvider');
  const entries = handles.map((h) => ctx.get(h));
  const primary = entries[0] ?? IDLE;
  const key = handles.filter(Boolean).join(',');
  const decrypt = useCallback(() => ctx.decryptMany(handles, contractAddress), [ctx, key, contractAddress]); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => handles.forEach((h) => ctx.clear(h)), [ctx, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const allSuccess = handles.length > 0 && entries.every((e) => e.status === 'success');
  return { status: primary.status, value: primary.value, error: primary.error, entries, allSuccess, decrypt, reset };
}
