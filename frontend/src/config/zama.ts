/**
 * Zama Relayer SDK wiring.
 *
 * Verified import detail: the installed `@zama-fhe/relayer-sdk` package's
 * `package.json` "main" points at a Node build. A browser bundle must
 * import the `/web` subpath instead, or it will pull in code that doesn't
 * run in a browser.
 */
import { createInstance, initSDK, SepoliaConfig, type FhevmInstance } from '@zama-fhe/relayer-sdk/web';
import { rpcUrls } from './web3';

let sdkInitPromise: Promise<void> | null = null;
let instancePromise: Promise<FhevmInstance> | null = null;
// Which entry of `candidates` (below) the currently-cached instance was
// built from. Used by `callFhevm` to advance to the next candidate and
// rebuild instead of retrying the same broken source.
let candidateIndex = 0;

/** Loads the SDK's WASM dependencies once per page load. */
function ensureSdkInitialized(): Promise<void> {
  if (!sdkInitPromise) {
    sdkInitPromise = initSDK()
      .then(() => undefined)
      .catch((err) => {
        // reset so a later retry can try again instead of being stuck on a
        // permanently-rejected cached promise
        sdkInitPromise = null;
        throw err;
      });
  }
  return sdkInitPromise;
}

/**
 * Candidate network sources for the FHE SDK's own internal on-chain reads
 * (ACL / InputVerifier / KMSVerifier registry lookups — nothing here signs
 * anything; wallet signatures happen separately via wagmi's
 * `signTypedDataAsync`). Order matters:
 *
 * OUR configured RPCs (VITE_SEPOLIA_RPC_URL, then the public fallback list
 * in config/web3.ts) come FIRST. `window.ethereum` — the connected wallet's
 * own injected provider — comes LAST, deliberately, and only as a
 * last-resort fallback.
 *
 * This used to be reversed (wallet first), which was a real, confirmed bug:
 * a wallet extension's Sepolia RPC is whatever the user happens to have
 * configured — commonly a free-tier public endpoint we have zero visibility
 * or control over (e.g. sepolia.drpc.org's free tier gating batched calls
 * with "please upgrade to paid plan"). `createInstance()` can succeed
 * immediately against that source (it doesn't eagerly validate
 * connectivity), and only the *later*, real registry read inside
 * `createEncryptedInput().encrypt()` / `userDecrypt()` fails — surfaced to
 * the user as an opaque RPC error that had nothing to do with our own app
 * config, because our app's own transport list never included drpc.org at
 * all. Defaulting to our own known-good endpoints removes that dependency
 * on whatever RPC the wallet happens to carry.
 */
function getCandidates(): (string | unknown)[] {
  const injected = (window as any).ethereum;
  const candidates: (string | unknown)[] = [...rpcUrls];
  if (injected) candidates.push(injected);
  return candidates;
}

function buildInstance(index: number): Promise<FhevmInstance> {
  return ensureSdkInitialized().then(async () => {
    const candidates = getCandidates();
    const network = candidates[Math.min(index, candidates.length - 1)];
    return createInstance({ ...SepoliaConfig, network: network as any });
  });
}

/** Returns a lazily-created, cached FhevmInstance configured for Sepolia. */
export function getFhevmInstance(): Promise<FhevmInstance> {
  if (!instancePromise) {
    instancePromise = buildInstance(candidateIndex).catch((err) => {
      instancePromise = null;
      throw err;
    });
  }
  return instancePromise;
}

/** True for errors that indicate the current network *source* is the
 * problem (gated free tier, rate limiting, dead RPC) rather than a real
 * application error (wrong ACL permissions, bad input, user rejection). */
function isNetworkSourceError(err: unknown): boolean {
  const msg = String((err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? err ?? '');
  return /free plan|upgrade to a paid|rate limit|429|too many requests|-32005|-32603|rpc request failed|http request failed|failed to fetch|network error|timeout/i.test(msg);
}

/**
 * Runs an operation against the cached FHE instance. If it fails with a
 * network-source-shaped error, discards the instance, advances to the next
 * candidate RPC, rebuilds, and retries — once per remaining candidate —
 * instead of surfacing the first flaky endpoint's failure as if it were a
 * permanent, unfixable error. Every real call site (encrypt, userDecrypt,
 * publicDecrypt) should go through this instead of calling
 * `getFhevmInstance()` directly.
 */
export async function callFhevm<T>(fn: (instance: FhevmInstance) => Promise<T>): Promise<T> {
  const candidates = getCandidates();
  let lastErr: unknown;
  for (let attempt = 0; attempt < candidates.length; attempt++) {
    try {
      const instance = await getFhevmInstance();
      return await fn(instance);
    } catch (err) {
      lastErr = err;
      if (!isNetworkSourceError(err)) throw err; // a real error — don't mask it by retrying
      instancePromise = null;
      candidateIndex = Math.min(candidateIndex + 1, candidates.length - 1);
    }
  }
  throw lastErr;
}
