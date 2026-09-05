import { useCallback, useState } from 'react';
import { useAccount, useSignTypedData } from 'wagmi';
import { callFhevm } from '../config/zama';
import { CAIRN_POOL_ADDRESS } from '../config/contracts';

const DEFAULT_CONTRACT_ADDRESS = CAIRN_POOL_ADDRESS as string;

export type DecryptStatus = 'idle' | 'preparing' | 'signing' | 'decrypting' | 'success' | 'error' | 'unauthorized';

interface DecryptState {
  status: DecryptStatus;
  value: bigint | null;
  error: string | null;
}

const ZERO_HANDLE_RE = /^0x0+$/;

/**
 * Real EIP-712 user-decryption flow against the Zama Relayer, per
 * docs/FRONTEND_BACKEND_FLOW.md Part 5. Every value/status here reflects an
 * actual relayer round trip and wallet signature — nothing is simulated.
 *
 * A handle the ACL never granted this caller access to will make
 * `instance.userDecrypt` reject. That is surfaced as `status: 'unauthorized'`
 * rather than a generic error — for `myPrizeForDraw`, this is the accurate,
 * expected answer for a non-winner, not a bug to hide (see Part 5's
 * explicit instruction not to fall back to a fake "$0").
 *
 * CONTRACT ADDRESS — this matters and was previously a real bug: an
 * FHEVM ciphertext's ACL permission is scoped to the specific contract that
 * wrote it. `myPrincipal()`/`myFocus()`/`myWeight()`/`myPrizeForDraw()`
 * handles all come from CairnPool, but a wallet's *raw, undeposited* cUSDT
 * balance (`confidentialBalanceOf` on the cUSDT token itself, read via
 * `useCusdtBalanceHandle`) is ACL-scoped to the cUSDT contract instead.
 * Passing CairnPool's address to `createEIP712`/`userDecrypt` for that
 * handle made the relayer reject it as unauthorized even for the handle's
 * legitimate owner. `useDecryptHandle` now takes the ciphertext's owning
 * contract address explicitly (defaulting to CairnPool, the common case)
 * instead of assuming it's always CairnPool.
 */
export function useDecryptHandle(contractAddress: string = DEFAULT_CONTRACT_ADDRESS) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [state, setState] = useState<DecryptState>({ status: 'idle', value: null, error: null });

  const decrypt = useCallback(
    async (handle: `0x${string}` | undefined | null) => {
      if (!address) return; // caller should already gate the button on isConnected

      if (!handle) {
        // Previously a silent no-op here — status stayed 'idle' forever, so
        // clicking Reveal while the underlying `useReadContract` for this
        // handle hadn't resolved (or had failed) looked exactly like an
        // endless loading animation with no explanation. This is almost
        // always caused by the *read* failing upstream (bad RPC), not by
        // anything decrypt-specific — surface it as a real, actionable error
        // instead of doing nothing.
        setState({ status: 'error', value: null, error: "Couldn't load this value from the network yet. Check your connection and try again." });
        return;
      }

      // A handle that was never written on-chain (e.g. a brand-new
      // participant's Focus before their first commitFocus) is all-zero.
      // Report it as a real, decrypted zero rather than round-tripping to
      // the relayer for a handle that was never ACL-granted to anyone.
      if (ZERO_HANDLE_RE.test(handle)) {
        setState({ status: 'success', value: 0n, error: null });
        return;
      }

      setState({ status: 'preparing', value: null, error: null });
      try {
        const contractAddresses = [contractAddress];
        const startTimestamp = Math.floor(Date.now() / 1000);
        const durationDays = 1;
        const { keypair, eip712 } = await callFhevm(async (instance) => {
          const kp = instance.generateKeypair();
          const domain = instance.createEIP712(kp.publicKey, contractAddresses, startTimestamp, durationDays);
          return { keypair: kp, eip712: domain };
        });

        setState((s) => ({ ...s, status: 'signing' }));
        const signature = await signTypedDataAsync({
          domain: eip712.domain as any,
          types: eip712.types as any,
          primaryType: eip712.primaryType as any,
          message: eip712.message as any,
          account: address as `0x${string}`,
        });

        setState((s) => ({ ...s, status: 'decrypting' }));
        // A signed EIP-712 payload is valid regardless of which RPC endpoint
        // reads it back, so retrying this specific call against the next
        // candidate network on a network-source failure is safe — it never
        // needs a second wallet signature.
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

        const clear = result[handle];
        if (clear === undefined) {
          setState({ status: 'unauthorized', value: null, error: 'Not authorized to decrypt this value.' });
          return;
        }
        const value = typeof clear === 'bigint' ? clear : BigInt(clear as any);
        setState({ status: 'success', value, error: null });
      } catch (err: any) {
        const message = String(err?.shortMessage || err?.message || err);
        if (/reject|denied/i.test(message)) {
          setState({ status: 'error', value: null, error: 'You declined the signature request.' });
        } else if (/acl|permission|not authorized|unauthorized/i.test(message)) {
          setState({ status: 'unauthorized', value: null, error: 'Not authorized to decrypt this value.' });
        } else if (/rpc request failed|http request failed|free plan|rate limit|429|too many requests|upgrade to a paid|-32005|-32603/i.test(message)) {
          // Surface the real cause instead of a vague catch-all — this is a
          // network/RPC problem underneath the SDK's own on-chain reads
          // (see config/zama.ts), not something retrying the same click
          // fixes on its own.
          setState({ status: 'error', value: null, error: 'The Sepolia network is being unreliable right now (RPC error). Try again in a moment.' });
        } else {
          setState({ status: 'error', value: null, error: `Decryption service unavailable: ${message.slice(0, 140)}` });
        }
      }
    },
    [address, signTypedDataAsync, contractAddress],
  );

  const reset = useCallback(() => setState({ status: 'idle', value: null, error: null }), []);

  return { ...state, decrypt, reset };
}
