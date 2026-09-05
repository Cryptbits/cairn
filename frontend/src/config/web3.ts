import { http, fallback, createConfig } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

// A single free-tier RPC can throttle, or simply stop serving Sepolia
// entirely (confirmed live: sepolia.drpc.org started returning "chain is
// not available on free plan, please upgrade to paid plan" — a real
// JSON-RPC error response, not a network-level failure, which viem's
// `fallback` transport does not always treat as a reason to move on to the
// next provider). Falling back across several public Sepolia endpoints
// means one dead/gated provider doesn't take the whole app down — but only
// if `rank` is enabled, so viem actively health-checks each transport and
// deprioritizes ones that keep failing, instead of trusting list order.
// Set VITE_SEPOLIA_RPC_URL to put your own (Alchemy/Infura/etc.) endpoint
// first for the most reliable experience.
const customRpc = import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined;
const publicRpcs = [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://rpc.sepolia.org',
  'https://1rpc.io/sepolia',
  'https://rpc.ankr.com/eth_sepolia',
  'https://eth-sepolia.public.blastapi.io',
];
// Exported so config/zama.ts can retry the Relayer SDK's own on-chain reads
// against these same known-good public endpoints if the wallet's configured
// RPC is the thing throttling — see that file's comment for why this matters.
export const rpcUrls = customRpc ? [customRpc, ...publicRpcs] : publicRpcs;

export const config = createConfig({
  chains: [sepolia],
  connectors: [
    injected(),
  ],
  transports: {
    // `batch` collapses same-tick JSON-RPC calls (Home/Draw/Claim each fire
    // several `useReadContract` reads at once) into one HTTP request instead
    // of N parallel ones. `fallback` with `rank: true` continuously probes
    // each transport's latency/error rate and reorders/skips consistently
    // failing ones, instead of always hitting them first in list order.
    [sepolia.id]: fallback(
      rpcUrls.map((url) => http(url, { retryCount: 2, retryDelay: 500, batch: { wait: 40 }, timeout: 8_000 })),
      { rank: true },
    ),
  },
})
