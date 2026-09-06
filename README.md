# Cairn

**A confidential prize-savings pool.** Deposit, keep your principal safe
and withdrawable at any time, and take a shot at winning the pool's prize
in periodic draws — without anyone, including Cairn itself, ever seeing
what you or anyone else has in the pool.

Built for the Zama Developer Program Mainnet Season 4 (Confidential
PoolTogether track), on Sepolia.

**Live app:** https://cairn-pool.vercel.app

**Deployed contract (Sepolia):** 0x86F3861ae89b5578319997434e9c82C3bA697a8e

**Contracts:** `contracts/CairnPool.sol` deployed via `scripts/deploy.ts`
(`npm run deploy:sepolia`), funded via `scripts/fundYieldSource.ts`, and
kept moving via the keeper bot in `scripts/keeper.ts` — see [Draw
automation](#draw-automation-who-pays-the-gas) below for how that last one
works.

## Getting test tokens

Cairn's pool uses Zama's official Sepolia cUSDT wrapper, not a private
mock token — the same one listed in
[Zama's Protocol Registry](https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia#wrappers-registry),
so anyone can obtain it the standard way any Zama confidential app expects:

1. **Sepolia ETH** for gas — any public Sepolia faucet (e.g.
   [Google Cloud's](https://cloud.google.com/application/web3/faucet/ethereum/sepolia)
   or [Chainlink's](https://faucets.chain.link/sepolia)).
2. **Testnet USDT**, the plain ERC-20 that cUSDT wraps — its address is
   [`0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0`](https://sepolia.etherscan.io/address/0xa7dA08FafDC9097Cc0E7D4f113A61e31d7e8e9b0)
   (confirmed against [Zama's Sepolia registry](https://docs.zama.org/protocol/protocol-apps/addresses/testnet/sepolia#wrappers-registry)
   as of September 2026 — reconfirm at that link if this has since
   changed). It exposes a **public `mint(address to, uint256 amount)`**,
   capped at 1,000,000 tokens per call — call it directly from Etherscan's
   "Write Contract" tab with your own address, no faucet request or
   allowlist needed.
3. **Wrap it into cUSDT** at [portfolio.zama.org](https://portfolio.zama.org)
   — Zama's Portfolio App, which covers shielding/unshielding/transfers on
   both Ethereum mainnet and Sepolia testnet. Select Sepolia once connected
   (`app.zama.org/shield` is the mainnet-only quick-shield action and won't
   show this testnet token).
4. Deposit the resulting cUSDT into Cairn as normal.

## What it is

Cairn works like a savings account crossed with a raffle you can't lose:

- **Deposit cUSDT.** It's yours, whenever you want it. There's no lockup —
  withdraw your principal at any time.
- **Every so often, a draw picks one winner** from everyone with a position
  in the pool. Your odds are proportional to your weight in the pool.
  Winning doesn't cost you your deposit — it's a prize on top, drawn from
  the pool's reserve.
- **Everything about your position is private.** Your balance, your odds,
  and your prize (until you decrypt it yourself) are encrypted end to end,
  using Zama's fully homomorphic encryption (FHE). The pool can compute
  with your numbers — total them, compare them, run a weighted draw over
  them — without ever seeing what they actually are.

## How a draw actually works

1. **Everyone marks themselves ready.** A draw only starts once every
   saver currently in the pool has confirmed they're ready for it — no
   one wallet can start a round alone, and no one can be swept into a
   draw they haven't agreed to.
2. **The draw runs on encrypted balances.** The moment everyone's ready
   (and the minimum interval since the last draw has elapsed — a protocol
   parameter, not a fixed clock), the pool totals every saver's principal
   and draws a winner proportional to that principal — all over encrypted
   values. *Who actually submits the three on-chain calls that advance
   this (`requestDrawResolution` → `submitTotalWeight` →
   `submitWinner`)* is a separate question from the FHE mechanics above —
   see [Draw automation](#draw-automation-who-pays-the-gas) right below.
3. **A winner is picked.** The winning address becomes public — that's
   what makes the draw independently verifiable by anyone — but no
   individual balance or prize is ever revealed as part of that process.
4. **Only the winner can see their prize.** It's encrypted until the
   winner chooses to decrypt it, and only they hold the key to do so.
   Claiming credits it straight back into their (still encrypted)
   principal, ready to withdraw like anything else.

## Draw automation — who pays the gas

`requestDrawResolution`, `submitTotalWeight`, and `submitWinner` on
`CairnPool.sol` are **permissionless by design** — any address can call
them, and that's deliberate: the protocol keeps functioning even if every
operator disappears. But permissionless doesn't mean "whichever saver
happens to have the app open" should be the one paying gas to advance a
draw for the entire pool — that's not a cost any individual depositor
signs up for, and an earlier version of this frontend made exactly that
mistake by auto-firing these calls from any connected wallet that
happened to observe the right on-chain state first.

**How it actually runs now:** a dedicated keeper bot
(`scripts/keeper.ts`) polls the pool and calls these three functions
itself, on its own Sepolia wallet, whenever a draw is eligible or
mid-flight. It uses the same Zama relayer SDK call the frontend uses
client-side (`publicDecrypt`) to fetch the KMS-verified total weight and
winner before submitting them — no offchain RNG, same as the rest of the
design. Run it with:

```bash
npm run keeper          # one pass — good for cron / a scheduled GitHub Action
npm run keeper:watch    # polls continuously (KEEPER_POLL_INTERVAL_SECONDS, default 15s)
```

It needs its own funded Sepolia wallet in `KEEPER_PRIVATE_KEY` (see
an env file at `config/.env` — see `scripts/keeper.ts`'s own header comment
for the exact variables) — no special privilege, just gas money, since
these functions are open to anyone.

**If the keeper is down:** the pool owner sees a manual "Admin: start /
continue draw now" fallback button on the Draw screen (gated to the
`owner()` address only — never shown to a regular saver), or anyone can
call the same three functions directly from Etherscan's "Write Contract"
tab, since they're permissionless. This is the "documented keeper/admin
flow" the bounty spec allows as an alternative to full on-chain
automation (e.g. Chainlink Automation), and is the fix that was actually
needed here — not a contract change, just a change in *who* calls
functions that were already open to anyone.

Regular savers only ever sign two kinds of transactions on this screen:
`setReadyForDraw` (their own readiness signal) and, if they win,
`claimPrize`. No saver is ever asked to advance a draw on anyone else's
behalf.

## What's private, what's public — and any leakage, stated plainly

**Only you can ever see:** your principal and your prize amount before you
decrypt it. These are `euint64` values, ACL-gated to your address alone —
the contract itself never decrypts them to run a draw; it computes over
the ciphertexts directly (sum, compare, select).

**Public on chain, by necessity:**
- That a draw exists, its ID, and its current stage.
- Cohort size (how many participants a given draw scanned) and the live
  participant count.
- The round's **aggregate** total draw weight, once KMS-verified — a
  single summed number, never broken back out per participant.
- The winning address, once resolved. This is required, not incidental:
  an ACL grant needs a real recipient, and a draw that never reveals who
  won can't be independently checked by anyone outside the app.
- Protocol parameters: minimum cohort size, minimum draw interval, yield
  rate — all public config, not user data.

**What this leaks, honestly:** an outside observer watching the chain can
infer that *someone* deposited, roughly *when*, and *who* won each round
— standard for any onchain system with public transaction metadata, FHE
or not. What FHE removes is the part that matters for a savings product:
no one can see *how much* any specific person has, what their odds are,
or what they won, only that activity occurred. The one aggregate number
that becomes public (a round's total weight) is deliberately not
decomposable back into individual balances — it's a sum, not a list.

## The yield source — how it works, and how a real one would plug in

The bounty explicitly allows a mock yield source ("e.g., an admin-funded
prize reserve") as long as it's documented, so here's exactly how Cairn's
works:

**How it works today:** the contract owner seeds an encrypted pot
(`_yieldSource`) with real cUSDT via `fundYieldSource`, once upfront (not
per round). Each draw, the moment its total weight is KMS-verified,
`submitTotalWeight` **automatically** computes that round's prize as
`yieldRateBps` of the verified total — no manual per-round funding step —
and clamps the payout via `FHE.min` to whatever's actually left in the
source, so a draw can never authorize paying out more than what's really
custodied. **`yieldRateBps` itself is a placeholder with no research
behind it, and the bounty spec doesn't require any particular value (or
even this automatic mechanism — a plain admin-funded reserve is
explicitly acceptable too).** There is no real lending/yield market on
Sepolia for this test token to derive any rate, considered or otherwise,
from — decide your own value via the `YIELD_RATE_BPS` env var before
deploying, or change it after via the owner-only `setYieldRateBps`.
`fundYieldSource` can be called from the owner-only "Fund yield source" panel
built into the frontend itself — it appears in the sidebar under "Owner
tools" automatically once the connected wallet matches the contract owner
— or by running `scripts/fundYieldSource.ts` directly (see that script's
header comment for the required env vars).

**How a real yield source would plug in:** replace the `yieldRateBps *
total` calculation in `submitTotalWeight` with a read from an actual
yield-bearing position — for example, routing pooled principal into a
real confidential vault (the same pattern as
[Zama's own Steakhouse Confidential Prime USDC vault on Morpho](https://www.zama.org/post/steakhouse-confidential-prime-usdc-vault-on-morpho-deposits-now-live))
and using the vault's real accrued share value as the prize instead of an
admin-set rate. The rest of the draw mechanic — encrypted weighting,
FHE-random winner selection, winner-only decryption — would not need to
change at all; only where the prize number comes from would.

## Winner selection — the FHE randomness design

`submitTotalWeight` draws an unbounded `FHE.randEuint64()` and reduces it
into `[0, total)` via `FHE.rem` against the KMS-verified total weight,
then walks the cohort's cumulative encrypted weight to find who it lands
on — entirely on-chain, entirely over ciphertexts, no off-chain RNG at any
point. One deliberate implementation detail worth documenting: Zama's own
[randomness guide](https://docs.zama.org/protocol/solidity-guides/smart-contract/operations/random)
states that `FHE.randEuint64`'s *bounded* form requires its upper bound to
be a power of 2 — a round's total weight essentially never is one, so
`FHE.randEuint64(total)` directly would fail on almost every real draw.
Using the unbounded draw plus a plaintext-divisor `FHE.rem` avoids that
constraint entirely while keeping the result genuinely uniform over
`[0, total)` (the same negligible modulo bias any `random() % n` reduction
has, immaterial at real pool-weight magnitudes).

## Error handling

- **Missing operator approval**: detected before a deposit/withdraw is
  attempted (`useIsPoolOperator` reads `CUSDT.isOperator` live) — the app
  prompts the one-time approval step rather than letting a transaction
  fail.
- **Insufficient balance**: `withdraw` clamps to your real decrypted
  principal rather than reverting on an over-request; `deposit` surfaces
  the real on-chain revert in plain language if it happens.
- **Network mismatch**: a dedicated banner (`WrongNetworkNotice`) appears
  and offers a one-click Sepolia switch whenever a connected wallet is on
  the wrong chain, before any action is attempted.
- **Unsupported tokens**: not applicable by design — Cairn's pool is
  hardcoded to one specific, officially-registered cUSDT wrapper address
  rather than accepting an arbitrary token, so there's no "wrong token"
  state to reach.
- **Zero draw weight**: if a round has no deposits at all, the contract
  correctly refuses to draw a winner. The app detects this from the
  relayer's already-decrypted value *before* ever sending a transaction
  that's guaranteed to revert, and explains it in plain language instead.
- **Every async step** (encrypt, sign, submit, confirm) has its own
  visible state — nothing sits silently between a click and a wallet
  prompt with no feedback.

## Why it's built this way

- **No admin bottleneck, no depositor bottleneck either.** The three
  draw-progression calls stay permissionless onchain (see [Draw
  automation](#draw-automation-who-pays-the-gas)) so the pool keeps
  working even if whoever deployed it walks away — but in normal
  operation a dedicated keeper bot, not a random saver's wallet, is the
  one actually paying the gas to carry a draw through to a winner.
- **Real money moves.** Deposits, withdrawals, and prizes move actual
  confidential cUSDT tokens on Sepolia, not an internal point system.
- **Nothing is faked in the UI.** If something genuinely can't happen yet
  — say, a round with no weight to draw over — the app says so plainly
  instead of pretending or silently failing.
- **No decorative mechanics.** An earlier version of this pool had a
  "Focus" feature — committing part of your principal for extra draw
  weight, pitched as an opportunity-cost tradeoff. It was removed: this
  pool has no per-user yield for anything to trade off against (prizes
  are a flat rate on the pool's total weight, not individual yield), so
  Focus had no real cost and only ever increased odds for free. A
  mechanic marketed as a tradeoff with no actual tradeoff undermines a
  no-loss product's credibility rather than adding to it, so it's gone
  rather than kept as decoration.

## Where things live

```
contracts/     CairnPool.sol — the pool contract
frontend/      the app itself
scripts/       deployment, yield-source-funding, and draw-keeper tooling
  deploy.ts           deploy CairnPool to Sepolia — npm run deploy:sepolia
  fundYieldSource.ts  seed the prize reserve (owner-only, run after deploy)
  keeper.ts           automated bot that advances draws — see "Draw automation" above
  benchmarkHCU.ts     verifies MAX_COHORT_SIZE against the real per-tx HCU budget
  deployLocal.ts      local-network variant of deploy.ts, for development only
test/          contract tests
.github/workflows/keeper.yml   scheduled GitHub Action that runs the keeper bot
```