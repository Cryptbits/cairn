/**
 * Contract configuration — single source of truth for address/ABI wiring.
 *
 * ABI PROVENANCE: CairnPool.abi.json and IERC7984.abi.json in this folder
 * were produced by actually compiling contracts/CairnPool.sol (and the
 * installed `@openzeppelin/confidential-contracts` IERC7984 interface) with
 * solc 0.8.24 via `solc-js` in this workspace — a real compile, not a hand
 * transcription. (The sandbox this integration pass ran in cannot reach
 * `binaries.soliditylang.org` to run `npx hardhat compile`'s native solc
 * download, so solc-js — the pure-WASM build, already a transitive
 * dependency here — was used directly instead. Functionally identical
 * output; same compiler version pinned in hardhat.config.ts.)
 *
 * Regenerate both files after any contract change:
 *   node -e "console.log('see docs/DEPLOYMENT.md for the exact solc-js or hardhat compile command')"
 * or simply `npm run compile` once you have normal network access, then
 * copy the ABI out of artifacts/contracts/CairnPool.sol/CairnPool.json.
 */
import CAIRN_POOL_ABI_JSON from './CairnPool.abi.json';
import IERC7984_ABI_JSON from './IERC7984.abi.json';

export const CAIRN_POOL_ABI = CAIRN_POOL_ABI_JSON as unknown as readonly Record<string, unknown>[];
export const IERC7984_ABI = IERC7984_ABI_JSON as unknown as readonly Record<string, unknown>[];

/** Mirrors `enum DrawStage` in CairnPool.sol exactly. */
export const DRAW_STAGE = ['None', 'TotalWeightRequested', 'TotalWeightSubmitted', 'WinnerRequested', 'Resolved'] as const;
export type DrawStageName = (typeof DRAW_STAGE)[number];

export const SEPOLIA_CHAIN_ID = 11155111;

/**
 * Deployed CairnPool address. Not available until `npm run deploy:sepolia`
 * has actually been run against a real cUSDT address — see
 * docs/DEPLOYMENT.md. Read from Vite env (this is a Vite app, not
 * Next.js — only `VITE_`-prefixed vars are exposed to client code).
 */
export const CAIRN_POOL_ADDRESS = (import.meta.env.VITE_CAIRN_CONTRACT_ADDRESS || '') as `0x${string}` | '';
export const isContractConfigured = CAIRN_POOL_ADDRESS.length === 42 && CAIRN_POOL_ADDRESS.startsWith('0x');

/**
 * The real ERC-7984 confidential cUSDT wrapper CairnPool custodies.
 * Resolve this from Zama's official Confidential Token Wrappers Registry
 * for Sepolia (see docs/DEPLOYMENT.md — do not guess this address) and pass
 * the SAME address you deployed CairnPool with here, so the frontend's
 * "approve" (setOperator) step targets the exact token the pool expects.
 */
export const CUSDT_ADDRESS = (import.meta.env.VITE_CUSDT_CONTRACT_ADDRESS || '') as `0x${string}` | '';
export const isCusdtConfigured = CUSDT_ADDRESS.length === 42 && CUSDT_ADDRESS.startsWith('0x');
