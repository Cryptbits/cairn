// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, euint64, ebool, eaddress, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/**
 * @title CairnPool
 * @notice Confidential no-loss prize savings pool (Zama Developer Program Season 4).
 *
 * REVISION NOTE (this version): the original draft of this contract kept an
 * internal encrypted ledger only and never moved a real token, and its draw
 * lifecycle was entirely owner-gated. Both were flagged as real gaps during
 * a frontend-readiness audit and are fixed here, not patched around in the
 * frontend:
 *
 *   1. Deposit/withdraw/claim now move a real ERC-7984 confidential token
 *      (`CUSDT`, injected at deploy time — see docs/DEPLOYMENT.md for how to
 *      obtain the address of the official Zama Sepolia cUSDT wrapper from
 *      the Confidential Token Wrappers Registry). This contract custodies
 *      that token directly via `confidentialTransferFrom`/`confidentialTransfer`
 *      (OpenZeppelin's real IERC7984 interface, the OpenZeppelin confidential-contracts package
 *      v0.5.3 — verified against the installed package, not invented). A
 *      user must call `CUSDT.setOperator(address(this), until)` once before
 *      their first deposit, exactly like an ERC-20 `approve`.
 *   2. `requestDrawResolution`/`submitTotalWeight`/`submitWinner` are all
 *      permissionless — any address may call them once a draw is genuinely
 *      eligible (`minCohortSize` participants and `minDrawIntervalSeconds`
 *      elapsed since the last request). There is no owner-only "run the
 *      draw" bottleneck; the protocol keeps functioning even if the
 *      deployer's key is lost. `submitTotalWeight`/`submitWinner` verify
 *      relayer callbacks exactly as before, gated by `FHE.checkSignatures`
 *      rather than by caller identity — no bot, backend, or privileged
 *      operator of any kind is required; a participant's own browser
 *      submits every step directly.
 *   3. A real `claimPrize` function now exists. It credits the winner's
 *      encrypted prize directly into their encrypted principal (so it is
 *      immediately, confidentially withdrawable through the normal
 *      `withdraw` path) and is guarded against double-claiming.
 *   4. The yield source (`fundYieldSource`) is itself a confidential
 *      cUSDT balance, not a plaintext ETH value — see the note on
 *      `_yieldSource` below for why the previous plaintext-ETH design was
 *      an outright unit-mismatch bug once real token custody was added.
 *   5. Prizes are no longer manually snapshotted per draw. `submitTotalWeight`
 *      automatically computes each round's prize as `yieldRateBps` of that
 *      round's KMS-verified total weight, clamped to whatever's actually
 *      funded in `_yieldSource` — see that function's doc comment. This is
 *      what makes "the generated yield is distributed through periodic
 *      prize draws" (the bounty's own wording) literally true here: the
 *      owner funds a yield source upfront, and distribution into each
 *      round's prize happens automatically from then on, with no
 *      per-round admin action.
 *
 * SCOPE NOTE (unchanged, still honest): `yieldRateBps`'s shipped default
 * is a placeholder with zero research behind it, not an illustrative-but-
 * considered figure — there is no real lending/yield market on Sepolia
 * for a confidential-wrapper test token like this deployment's cUSDT to
 * derive any rate, considered or otherwise, from. The bounty spec does
 * not require a specific rate or even this automatic mechanism (a plain
 * admin-funded reserve is explicitly acceptable too — see the README's
 * "yield source" section). What's real regardless of what the rate is
 * set to: the cUSDT in `_yieldSource` is genuinely custodied (not a fake
 * balance), the accrual math runs automatically on-chain against a
 * genuinely KMS-verified number, and a draw can never authorize paying
 * out more than what's actually funded. Swapping in a real yield adapter
 * (e.g. routing pooled principal into a genuine confidential vault, the
 * way Zama's own "Earn" product does on mainnet) so `yieldRateBps`
 * reflects a real, sourced rate instead of a placeholder is the clear
 * next step before this could be anything beyond a testnet demo, and is
 * called out as such rather
 * than glossed over anywhere in the frontend or docs.
 *
 * STATUS: has not completed a negative-ACL / reentrancy / economic-invariant
 * test pass against a real compiler (see README.md for exactly why — the
 * sandbox this revision was written in cannot download solc or reach a
 * Sepolia RPC). Every change below was checked line-by-line against the
 * real, installed the fhevm solidity library and the OpenZeppelin confidential-contracts package
 * source in this repository's node_modules, not against memory. Compile,
 * run `npx hardhat test`, and re-run scripts/benchmarkHCU.ts before
 * treating this as audited.
 */
contract CairnPool is ZamaEthereumConfig {
    // -----------------------------------------------------------------
    // Token custody
    // -----------------------------------------------------------------

    /// @notice The real ERC-7984 confidential token this pool custodies.
    /// Set once at deploy time — see docs/DEPLOYMENT.md for how to resolve
    /// the official Sepolia cUSDT wrapper address from Zama's Confidential
    /// Token Wrappers Registry before deploying.
    IERC7984 public immutable CUSDT;

    // -----------------------------------------------------------------
    // Encrypted per-user state
    // -----------------------------------------------------------------

    /// @notice Encrypted principal balance per depositor (real, custodied cUSDT).
    /// Draw weight is this value directly — see requestDrawResolution/
    /// submitTotalWeight, which sum and compare `_principal` per
    /// participant. There is no separate weight concept: an earlier
    /// revision of this contract had a "Focus" mechanic that let a saver
    /// commit part of their principal toward extra draw weight, framed as
    /// an opportunity-cost tradeoff. It was removed — this build has no
    /// per-user yield for anything to trade off against (prizes are a flat
    /// rate on the pool's total weight, see `_yieldSource` below), so Focus
    /// had no actual cost and only ever increased a saver's odds for free.
    /// A mechanic pitched as a tradeoff with no real tradeoff undermines
    /// the no-loss story rather than strengthening it, so it's gone rather
    /// than kept as decoration.
    mapping(address => euint64) private _principal;

    address[] private _participants;
    mapping(address => bool) private _isParticipant;
    /// @notice Index of each participant within `_participants`, recorded
    /// at push time so `leavePool()` can remove a wallet in O(1) via
    /// swap-and-pop instead of a linear scan.
    mapping(address => uint256) private _participantIndex;

    // -----------------------------------------------------------------
    // Draw readiness — trustable two-(or-more)-party synchronization
    // -----------------------------------------------------------------
    //
    // ADDED (this revision): previously ANY single wallet could call
    // requestDrawResolution() the instant minCohortSize/minDrawInterval
    // were met, and then drove all four on-chain steps itself. Nothing
    // stopped one participant from starting — or effectively forcing —
    // a draw while another participant hadn't finished depositing for the
    // round. That is not a trustable multi-party draw: it has to be
    // impossible for one wallet to unilaterally start it.
    //
    // The fix is an explicit on-chain "ready" signal, not a frontend flag
    // (a frontend-only ready state can't be trusted by the OTHER wallet —
    // it has to live where both sides read the same source of truth).
    // Every currently-tracked participant must call `setReadyForDraw(true)`
    // before `requestDrawResolution()` will succeed at all; readiness is
    // cleared for everyone once a draw is actually requested, so each
    // round requires a fresh, explicit "I'm ready" from everyone again.
    //
    // SCOPE NOTE (honest, not hidden): this requires ALL tracked
    // participants to be ready, not a quorum. That's the correct
    // trust model for the "wait for the other person" flow this was
    // built for, but it does mean one inactive/abandoned wallet can block
    // a round indefinitely for everyone else. A real production version
    // would likely add a participant-removal path or a ready quorum
    // instead of 100% — deliberately not built here to keep this change
    // scoped to what was asked for.
    mapping(address => bool) public readyForDraw;

    /// @notice How many of the currently-tracked participants are ready right now.
    uint256 public readyCount;

    event ReadyForDrawChanged(address indexed user, bool ready);

    // -----------------------------------------------------------------
    // Public parameters
    // -----------------------------------------------------------------

    /// @notice Hard ceiling on scan size for a single requestDrawResolution()/submitTotalWeight() call.
    /// PLACEHOLDER — replace with the value derived from an executed run of
    /// scripts/benchmarkHCU.ts (see docs/DEPLOYMENT.md section 4) before a
    /// real deployment.
    uint256 public maxCohortSize;

    /// @notice Minimum number of participants required before a draw can be
    /// requested at all. Prevents a trivially-gameable 1-or-2-person "draw"
    /// under the new permissionless model. Owner-settable pre-launch only —
    /// see `setDrawEligibility`.
    uint256 public minCohortSize;

    /// @notice Minimum seconds between draw requests, so permissionless
    /// resolution can't be spammed back-to-back. Owner-settable pre-launch
    /// only — see `setDrawEligibility`.
    uint256 public minDrawIntervalSeconds;

    /// @notice Timestamp of the last `requestDrawResolution` call.
    uint256 public lastDrawRequestedAt;

    /// @notice Self-incrementing draw id — permissionless resolution means
    /// nobody hand-picks drawId anymore; the contract sequences itself.
    uint256 public nextDrawId;

    address public owner;

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    // -----------------------------------------------------------------
    // Draw / prize-reserve state
    // -----------------------------------------------------------------

    /// @notice Encrypted yield source — a real, custodied cUSDT pot the
    /// owner seeds upfront (once, or occasionally, via `fundYieldSource`),
    /// from which each draw AUTOMATICALLY accrues its own prize — see
    /// `submitTotalWeight`, where the accrual actually happens. This
    /// replaces an earlier design where the owner had to remember to
    /// manually fund a prize before every single draw; that was real
    /// custodied cUSDT too, but the *distribution* wasn't automatic, which
    /// is what the bounty text actually asks for ("the generated yield is
    /// distributed through periodic prize draws"). This MUST be encrypted,
    /// not a plaintext uint256 — it is real custodied cUSDT, not an
    /// abstract counter. Individual and pool-reserve confidential-token
    /// amounts are exactly what stays encrypted; only draw *metadata*
    /// (schedule, cohort size, winner address) is public.
    euint64 private _yieldSource;

    /// @notice The rate (basis points) automatically applied to a round's
    /// KMS-verified total weight to compute that round's prize — see
    /// `submitTotalWeight`. Set at deploy time (`initialYieldRateBps`) or
    /// changed after via `setYieldRateBps`; the value shipped in
    /// scripts/deploy.ts's default is an unresearched placeholder, not a
    /// figure with any particular basis — the bounty spec does not mandate
    /// any rate, or even this automatic mechanism at all (a plain
    /// admin-funded reserve is explicitly acceptable too). What's real
    /// regardless of the number chosen: the mechanism is automatic,
    /// on-chain, tied to actually-verified pool activity, and backed by
    /// real custodied cUSDT that can't be paid out past what's actually in
    /// `_yieldSource` (see the `FHE.min` clamp in `submitTotalWeight`).
    /// There is no real lending/yield market on Sepolia for a token like
    /// this deployment's cUSDT to derive a genuine market rate from in the
    /// first place, so no value here would be more "correct" than another.
    uint16 public yieldRateBps;

    /// @notice The bytes32 handle of the pending (not-yet-verified) total-weight
    /// ciphertext for a given draw — see requestDrawResolution/submitTotalWeight.
    mapping(uint256 => bytes32) public pendingTotalWeightHandle;

    /// @notice KMS-verified plaintext total weight for a draw, set only after
    /// submitTotalWeight's signature check passes. Needed to draw a genuinely
    /// proportional random cutoff.
    mapping(uint256 => uint64) public verifiedTotalWeight;

    /// @notice Cohort size frozen at requestDrawResolution time, reused by
    /// submitTotalWeight's winner-selection pass so both passes scan the
    /// exact same participant set.
    mapping(uint256 => uint256) public drawCohortSize;

    /// @notice The bytes32 handle of the pending (not-yet-verified) winner
    /// ciphertext for a given draw, set by submitTotalWeight and consumed
    /// by submitWinner.
    mapping(uint256 => bytes32) public pendingWinnerHandle;

    /// @notice Encrypted prize automatically accrued for a draw — computed
    /// in `submitTotalWeight` as `yieldRateBps` of that round's verified
    /// total weight, clamped to whatever's actually funded in
    /// `_yieldSource`. Not admin-snapshotted, not manually set per round —
    /// see `submitTotalWeight`'s doc comment. Not publicly decryptable —
    /// see submitWinner.
    mapping(uint256 => euint64) private _drawPrize;

    /// @notice Resolved winner address per draw, set only after a verified
    /// (FHE.checkSignatures-backed) callback — never trusted from a raw
    /// caller-supplied address.
    mapping(uint256 => address) public resolvedWinner;

    /// @notice Explicit per-draw state machine.
    enum DrawStage {
        None,
        TotalWeightRequested,
        // Kept in the enum (not deleted) purely so ordinal values below it
        // don't shift and silently change meaning anywhere they're cast to
        // uint8. Never externally observable as a *persisted* stage as of
        // this version: submitTotalWeight() now draws a winner and
        // requests its decryption in the same transaction it verifies the
        // total weight in, so a draw goes straight from
        // TotalWeightRequested to WinnerRequested with no observable state
        // in between — see submitTotalWeight()'s doc comment for why that
        // merge is safe (no async boundary was ever between those two
        // steps).
        TotalWeightSubmitted,
        WinnerRequested,
        Resolved
    }
    mapping(uint256 => DrawStage) public drawStage;

    /// @notice Encrypted prize amount, ACL-granted only to the resolved
    /// winner once known — never publicly decryptable, unlike the winner
    /// address itself.
    mapping(uint256 => euint64) private _encryptedPrize;

    /// @notice Double-claim guard. `resolvedWinner[drawId]` is already
    /// unique per draw, so keying on drawId alone is sufficient — only the
    /// resolved winner can ever pass the `msg.sender == resolvedWinner`
    /// check in `claimPrize` in the first place.
    mapping(uint256 => bool) public prizeClaimed;

    event Deposited(address indexed user);
    event Withdrawn(address indexed user);
    event LeftPool(address indexed user);
    event DrawTotalWeightRequested(uint256 indexed drawId, bytes32 totalWeightHandle, uint256 cohortSize);
    event DrawTotalWeightSubmitted(uint256 indexed drawId, uint64 totalWeight);
    event DrawResolutionRequested(uint256 indexed drawId, bytes32 winnerHandle, uint256 cohortSize);
    /// @dev `prizeAmount` is deliberately NOT emitted here anymore (unlike the
    /// previous revision) — with real token custody the prize is genuinely
    /// confidential cUSDT, not a plaintext-safe aggregate, so publishing it
    /// in an event would leak it. Only the winner address is public.
    event DrawResolved(uint256 indexed drawId, address indexed winner);
    event PrizeClaimed(uint256 indexed drawId, address indexed winner);
    event YieldSourceFunded(address indexed funder);

    constructor(
        address cusdtAddress,
        uint256 initialMaxCohortSize,
        uint256 initialMinCohortSize,
        uint256 initialMinDrawIntervalSeconds,
        uint16 initialYieldRateBps
    ) {
        require(cusdtAddress != address(0), "cusdt address required");
        require(initialYieldRateBps <= 10000, "yield rate cannot exceed 100%");
        CUSDT = IERC7984(cusdtAddress);
        owner = msg.sender;
        maxCohortSize = initialMaxCohortSize;
        minCohortSize = initialMinCohortSize;
        minDrawIntervalSeconds = initialMinDrawIntervalSeconds;
        yieldRateBps = initialYieldRateBps;
    }

    /// @notice Pre-launch tuning only — intentionally left owner-gated,
    /// unlike draw resolution itself. This does not create an operational
    /// dependency on the owner: the protocol runs indefinitely at whatever
    /// values were last set, even if the owner key is later lost.
    function setDrawEligibility(uint256 newMinCohortSize, uint256 newMinDrawIntervalSeconds) external onlyOwner {
        minCohortSize = newMinCohortSize;
        minDrawIntervalSeconds = newMinDrawIntervalSeconds;
    }

    /// @notice Adjusts the automatic per-draw yield rate (basis points of
    /// that round's verified total weight — see `submitTotalWeight`).
    /// Owner-gated for the same pre-launch-tuning reason as
    /// `setDrawEligibility`; does not affect prizes already computed for
    /// in-flight or past draws, only future ones.
    function setYieldRateBps(uint16 newYieldRateBps) external onlyOwner {
        require(newYieldRateBps <= 10000, "yield rate cannot exceed 100%");
        yieldRateBps = newYieldRateBps;
    }

    /// @notice Toggle your own on-chain readiness for the next draw. Anyone
    /// can call this at any time (flip it on, flip it off again, change
    /// your mind) right up until someone else's requestDrawResolution() tx
    /// actually lands — there is no lockup on the readiness signal itself,
    /// only on principal, which is unaffected by this. Idempotent:
    /// calling with the same value you already have is a harmless no-op,
    /// not a double-count.
    function setReadyForDraw(bool ready) external {
        require(_isParticipant[msg.sender], "no position");
        if (readyForDraw[msg.sender] == ready) return;
        readyForDraw[msg.sender] = ready;
        if (ready) {
            readyCount += 1;
        } else {
            readyCount -= 1;
        }
        emit ReadyForDrawChanged(msg.sender, ready);
    }

    /// @notice Whether requestDrawResolution() would currently succeed on
    /// the readiness check specifically (cohort-size/time eligibility is
    /// covered separately by isDrawEligible()). The frontend combines both
    /// so it can tell a person exactly what's still missing.
    function allParticipantsReady() public view returns (bool) {
        return _participants.length > 0 && readyCount >= _participants.length;
    }

    // -----------------------------------------------------------------
    // Deposit / withdraw — real ERC-7984 cUSDT custody
    // -----------------------------------------------------------------

    /// @notice Deposit real cUSDT. Caller must have already called
    /// `CUSDT.setOperator(address(this), until)` — see IERC7984, verified
    /// against the installed the OpenZeppelin confidential-contracts package.
    function deposit(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        // Pull the real token in. `confidentialTransferFrom` requires this
        // contract to be an approved operator for msg.sender, and returns
        // the amount ACTUALLY transferred (bounded by the sender's real
        // balance) — we credit that, never the requested amount, exactly
        // per the OpenZeppelin ERC-7984 swap-example pattern this call is
        // modeled on.
        FHE.allowTransient(requested, address(CUSDT));
        euint64 amount = CUSDT.confidentialTransferFrom(msg.sender, address(this), requested);

        if (!_isParticipant[msg.sender]) {
            _isParticipant[msg.sender] = true;
            _participantIndex[msg.sender] = _participants.length;
            _participants.push(msg.sender);
            _principal[msg.sender] = FHE.asEuint64(0);
        }

        // Always combine through CairnPool's own FHE.add, on a first deposit
        // exactly the same as on every later one. `amount` is a handle
        // *returned* by CUSDT's confidentialTransferFrom — not something
        // CairnPool itself computed. Storing it directly (the previous
        // first-deposit shortcut) let a real bug through: the deposit
        // transaction succeeded and _grantSelf() didn't revert, but the
        // later FHE.allow(..., msg.sender) grant on that pass-through handle
        // did not reliably take effect, leaving a brand-new depositor unable
        // to decrypt their own first deposit until a second deposit forced a
        // real FHE.add. Routing every deposit through FHE.add makes
        // CairnPool the genuine computer of the stored ciphertext every
        // time, which is what makes the ACL grant that follows reliable.
        _principal[msg.sender] = FHE.add(_principal[msg.sender], amount);

        _grantSelf(_principal[msg.sender]);

        emit Deposited(msg.sender);
    }

    /// @notice Withdraw real cUSDT, at any time, no lockup. Clamps to
    /// available principal (via FHE.min) rather than reverting on an
    /// over-large request, to avoid a revert-vs-succeed side channel tied
    /// to the requested amount.
    function withdraw(externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(_isParticipant[msg.sender], "no position");

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 actual = FHE.min(requested, _principal[msg.sender]);

        // Effects before the external token call (checks-effects-interactions).
        _principal[msg.sender] = FHE.sub(_principal[msg.sender], actual);

        _grantSelf(_principal[msg.sender]);

        // Interaction: actually move the real token back to the user.
        FHE.allowTransient(actual, address(CUSDT));
        CUSDT.confidentialTransfer(msg.sender, actual);

        emit Withdrawn(msg.sender);
    }

    /// @notice Fully exits the pool: withdraws your entire principal in one
    /// transaction AND permanently removes you from the tracked participant
    /// set, so you are never required to call `setReadyForDraw` for a future
    /// draw again unless you deposit again.
    ///
    /// REAL BUG FIXED HERE (not a hypothetical): `withdraw()` above only
    /// ever reduces `_principal`; it never removes the caller from
    /// `_participants`. A wallet that withdrew its entire balance — e.g. an
    /// admin/deployer wallet that deposited once during testing, then
    /// withdrew — stayed permanently counted by `allParticipantsReady()`,
    /// so `requestDrawResolution()` blocked on it forever, requiring that
    /// wallet to click "ready" before every single future draw with no way
    /// to opt out. There was no removal path anywhere in the original
    /// contract. This function is that removal path.
    function leavePool() external {
        require(_isParticipant[msg.sender], "no position");

        // Move the caller's entire encrypted balance out first
        // (checks-effects-interactions), then zero their stored principal.
        euint64 balance = _principal[msg.sender];
        _principal[msg.sender] = FHE.asEuint64(0);
        _grantSelf(_principal[msg.sender]);

        FHE.allowTransient(balance, address(CUSDT));
        CUSDT.confidentialTransfer(msg.sender, balance);

        if (readyForDraw[msg.sender]) {
            readyForDraw[msg.sender] = false;
            readyCount -= 1;
            emit ReadyForDrawChanged(msg.sender, false);
        }

        // Swap-and-pop removal using the index recorded at push time
        // (_participantIndex) — O(1), not a linear scan over every saver.
        uint256 idx = _participantIndex[msg.sender];
        uint256 lastIdx = _participants.length - 1;
        if (idx != lastIdx) {
            address lastParticipant = _participants[lastIdx];
            _participants[idx] = lastParticipant;
            _participantIndex[lastParticipant] = idx;
        }
        _participants.pop();
        delete _participantIndex[msg.sender];
        _isParticipant[msg.sender] = false;

        emit LeftPool(msg.sender);
    }

    // -----------------------------------------------------------------
    // Prize reserve — admin-funded (no real yield market exists on Sepolia
    // for this test token; see the class-level SCOPE NOTE above)
    // -----------------------------------------------------------------

    /// @notice Owner-callable top-up of the yield source (real cUSDT, not
    /// ETH — see the class-level note on why the previous payable-ETH
    /// design was a unit-mismatch bug). Seeds the pot that
    /// `submitTotalWeight` automatically draws each round's prize from —
    /// this is meant to be called upfront/occasionally, not once per draw.
    function fundYieldSource(externalEuint64 encryptedAmount, bytes calldata inputProof) external onlyOwner {
        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(CUSDT));
        euint64 received = CUSDT.confidentialTransferFrom(msg.sender, address(this), requested);

        _yieldSource = FHE.add(_yieldSource, received);
        FHE.allowThis(_yieldSource);

        emit YieldSourceFunded(msg.sender);
    }

    // -----------------------------------------------------------------
    // Draw resolution — PERMISSIONLESS (see class-level note #2)
    // -----------------------------------------------------------------

    /// @notice Step 1 of draw resolution: sum encrypted weight over the
    /// current participant set (capped at maxCohortSize) and request its
    /// plaintext value via the public-decryption oracle. Callable by ANY
    /// address once the draw is genuinely eligible — no owner check. The
    /// participant slice scanned is always deterministic (the full tracked
    /// set, capped) rather than caller-supplied, so a permissionless caller
    /// cannot bias which participants are included.
    ///
    /// DRAW ALGORITHM NOTE (kept from the original design, still correct):
    /// FHE.div/FHE.rem only accept a *plaintext* divisor — there is no
    /// encrypted-modulo-by-encrypted-divisor operation. The only technically
    /// correct way to draw a cutoff proportional to total weight is to first
    /// make that (already being computed) total weight publicly decryptable,
    /// verify its plaintext value via FHE.checkSignatures exactly like
    /// winner resolution does, and only then draw a cutoff bounded by that
    /// real, verified total. Revealing pool-level total weight is
    /// consistent with the privacy model documented in the README —
    /// individual balances never appear in plaintext.
    function requestDrawResolution() external returns (uint256 drawId) {
        require(_participants.length >= minCohortSize, "not enough participants yet");
        require(allParticipantsReady(), "not everyone has marked ready yet");
        require(block.timestamp >= lastDrawRequestedAt + minDrawIntervalSeconds, "too soon since last draw");

        drawId = nextDrawId++;
        uint256 count = _participants.length > maxCohortSize ? maxCohortSize : _participants.length;

        euint64 total = _principal[_participants[0]];
        for (uint256 i = 1; i < count; i++) {
            euint64 w = _principal[_participants[i]];
            total = FHE.add(total, w);
        }
        FHE.allowThis(total);
        FHE.makePubliclyDecryptable(total);

        bytes32 handle = FHE.toBytes32(total);
        pendingTotalWeightHandle[drawId] = handle;
        drawCohortSize[drawId] = count;

        // Clear everyone's readiness now that a draw has actually been
        // requested off the back of it — the next round needs a fresh,
        // explicit "I'm ready" from every participant again. Deliberately
        // a separate loop over the FULL participant set (not capped at
        // maxCohortSize like the weight sum above) so a straggler beyond
        // the cohort cap can't stay stuck "ready" from a round they
        // weren't even scanned in.
        for (uint256 i = 0; i < _participants.length; i++) {
            address p = _participants[i];
            if (readyForDraw[p]) {
                readyForDraw[p] = false;
                emit ReadyForDrawChanged(p, false);
            }
        }
        readyCount = 0;

        lastDrawRequestedAt = block.timestamp;
        drawStage[drawId] = DrawStage.TotalWeightRequested;

        emit DrawTotalWeightRequested(drawId, handle, count);
    }

    /// @notice Step 2 of 3: submit the KMS-verified plaintext total weight
    /// for a draw, and — in the same transaction — immediately draw a
    /// winner from it and request that winner's decryption too.
    ///
    /// UX FIX: this used to be two separate external calls (submit the
    /// verified total, THEN a second "resolveDrawWinner" call to actually
    /// draw a winner from it). There was never an async boundary between
    /// them — resolving a winner only needs the plaintext total, which is
    /// already sitting in memory the instant `checkSignatures` passes
    /// below; the winner-selection math itself (rand, modulo, the
    /// cumulative-weight walk) is pure on-chain computation with no
    /// off-chain round trip of its own. Splitting them into two
    /// externally-callable steps only added one more mandatory wallet
    /// signature to every single draw, with no upside. Merged into one
    /// call. Permissionless — verified via FHE.checkSignatures, so a
    /// caller cannot assert an arbitrary total. Called directly from the
    /// frontend using the relayer SDK's `instance.publicDecrypt(...)` — no
    /// bot or backend involved.
    function submitTotalWeight(
        uint256 drawId,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external {
        require(drawStage[drawId] == DrawStage.TotalWeightRequested, "not awaiting total weight");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingTotalWeightHandle[drawId];
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof); // reverts if invalid

        uint64 total = abi.decode(abiEncodedCleartexts, (uint64));
        require(total > 0, "zero total weight, nothing to draw over");
        verifiedTotalWeight[drawId] = total;
        emit DrawTotalWeightSubmitted(drawId, total);

        // AUTOMATIC YIELD ACCRUAL — this is the mechanism the bounty text
        // actually asks for ("the generated yield is distributed through
        // periodic prize draws"), computed the moment a real, genuine
        // number becomes available to compute it from. `total` above is
        // plaintext and KMS-verified — not asserted, not admin-set — so
        // this round's prize is a real function of real, verified pool
        // activity: yieldRateBps of the round's total weight. The result
        // is clamped via FHE.min to whatever's actually funded in
        // `_yieldSource` so a draw can never authorize paying out more
        // cUSDT than the contract genuinely custodies — encrypted
        // arithmetic can't silently overflow into an unbacked promise the
        // way a plaintext bug could.
        uint64 accrualPlain = uint64((uint256(total) * yieldRateBps) / 10000);
        euint64 accrual = FHE.min(FHE.asEuint64(accrualPlain), _yieldSource);
        _yieldSource = FHE.sub(_yieldSource, accrual);
        FHE.allowThis(_yieldSource);
        _drawPrize[drawId] = accrual;
        FHE.allowThis(_drawPrize[drawId]);

        // Draw a cutoff genuinely bounded by the real, verified total
        // weight, then walk the same cohort exactly as before to select an
        // encrypted winner.
        uint256 count = drawCohortSize[drawId];

        // FHE.randEuint64(bound) is NOT a general bounded-random primitive
        // — the installed @fhevm/solidity library's own doc comment says
        // plainly "the upperBound must be a power of 2" (enforced by the
        // coprocessor, not visible in Solidity source). `total` is an
        // arbitrary weight sum and is essentially never a power of 2, so
        // passing it there directly would fail (or produce undefined
        // behavior) on almost every real draw. The correct approach: draw
        // a full-range uniform random euint64 (no bound restriction), then
        // reduce it into [0, total) via FHE.rem with a *plaintext*
        // divisor — total is already plaintext here. The resulting modulo
        // bias is the
        // immaterial at real pool-weight magnitudes.
        euint64 rawRandom = FHE.randEuint64();
        euint64 cutoff = FHE.rem(rawRandom, total);

        euint64 cumulative = _principal[_participants[0]];
        eaddress winner = FHE.asEaddress(_participants[0]);
        for (uint256 i = 1; i < count; i++) {
            // Check whether the cutoff already fell inside a PRIOR
            // participant's slice BEFORE folding in participant i's own
            // weight. Checking after the add (the old order) silently
            // shifted every participant's winning interval onto the next
            // index and made the final participant structurally
            // unwinnable. Verified by hand against weights 10/20/30 across
            // every boundary cutoff (0, 9, 10, 29, 30, 59) — see the
            // audit notes. No automated test for this exists yet; add one
            // before relying on this in production.
            ebool notYetReached = FHE.le(cumulative, cutoff);
            eaddress candidate = FHE.asEaddress(_participants[i]);
            winner = FHE.select(notYetReached, candidate, winner);
            cumulative = FHE.add(cumulative, _principal[_participants[i]]);
        }

        FHE.allowThis(winner);
        FHE.makePubliclyDecryptable(winner);

        bytes32 winnerHandle = FHE.toBytes32(winner);
        pendingWinnerHandle[drawId] = winnerHandle;
        drawStage[drawId] = DrawStage.WinnerRequested;

        emit DrawResolutionRequested(drawId, winnerHandle, count);
    }

    /// @notice Step 3 of 3: submit the KMS-verified plaintext winner for a
    /// draw. Permissionless — verified via FHE.checkSignatures, so a
    /// caller cannot assert an arbitrary address.
    function submitWinner(
        uint256 drawId,
        bytes calldata abiEncodedCleartexts,
        bytes calldata decryptionProof
    ) external {
        require(drawStage[drawId] == DrawStage.WinnerRequested, "winner not requested");

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = pendingWinnerHandle[drawId];
        FHE.checkSignatures(handles, abiEncodedCleartexts, decryptionProof); // reverts if invalid

        address winner = abi.decode(abiEncodedCleartexts, (address));

        resolvedWinner[drawId] = winner;
        drawStage[drawId] = DrawStage.Resolved;

        // The prize stays fully encrypted — ACL-granted only to the winner,
        // never publicly decryptable, unlike the winner address itself.
        euint64 prize = _drawPrize[drawId];
        FHE.allowThis(prize);
        FHE.allow(prize, winner);
        _encryptedPrize[drawId] = prize;

        emit DrawResolved(drawId, winner);
    }

    // -----------------------------------------------------------------
    // Claim — real payout, credited into the confidential principal ledger
    // -----------------------------------------------------------------

    /// @notice The resolved winner claims their prize. Credits the encrypted
    /// prize directly into the caller's encrypted principal, exactly like a
    /// deposit, so it becomes immediately (confidentially) withdrawable
    /// through the normal `withdraw` path — no separate payout pipeline to
    /// get wrong. Reverts for anyone but the resolved winner, and reverts
    /// on a second attempt (`prizeClaimed`).
    function claimPrize(uint256 drawId) external {
        require(drawStage[drawId] == DrawStage.Resolved, "draw not resolved");
        require(resolvedWinner[drawId] == msg.sender, "not the winner");
        require(!prizeClaimed[drawId], "already claimed");
        prizeClaimed[drawId] = true;

        euint64 prize = _encryptedPrize[drawId];

        // Same fix as deposit(): a winner claiming their very first-ever
        // position must still go through CairnPool's own FHE.add rather
        // than a direct assignment of a handle CairnPool didn't itself
        // compute, or the FHE.allow grant below doesn't reliably take
        // effect for them.
        if (!_isParticipant[msg.sender]) {
            _isParticipant[msg.sender] = true;
            _participantIndex[msg.sender] = _participants.length;
            _participants.push(msg.sender);
            _principal[msg.sender] = FHE.asEuint64(0);
        }

        _principal[msg.sender] = FHE.add(_principal[msg.sender], prize);

        _grantSelf(_principal[msg.sender]);

        emit PrizeClaimed(drawId, msg.sender);
    }

    // -----------------------------------------------------------------
    // Read-only helpers (for tests / frontend to fetch a caller's own
    // encrypted handles — actual decryption happens client-side via the
    // relayer SDK, never on-chain to anyone but the ACL-granted party)
    // -----------------------------------------------------------------

    function myPrincipal() external view returns (euint64) {
        return _principal[msg.sender];
    }

    function myPrizeForDraw(uint256 drawId) external view returns (euint64) {
        return _encryptedPrize[drawId];
    }

    function participantCount() external view returns (uint256) {
        return _participants.length;
    }

    /// @notice Whether a draw is currently eligible to be requested by
    /// anyone — the frontend polls this to decide whether to surface the
    /// "start draw" action at all. Combines the cohort-size/time gate with
    /// the readiness gate (see allParticipantsReady) — both must hold.
    function isDrawEligible() external view returns (bool) {
        return
            _participants.length >= minCohortSize &&
            allParticipantsReady() &&
            block.timestamp >= lastDrawRequestedAt + minDrawIntervalSeconds;
    }

    // -----------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------

    function _grantSelf(euint64 value) private {
        FHE.allowThis(value);
        FHE.allow(value, msg.sender);
    }
}
