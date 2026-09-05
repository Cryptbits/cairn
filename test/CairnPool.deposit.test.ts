/**
 * Deposit/withdraw/claim/ACL/permissionless-draw correctness tests against
 * the local fhevm mock coprocessor and a real (test-only) ERC-7984 token —
 * contracts/test/MockCUSDT.sol, not a fake accounting shortcut.
 *
 * NOT YET EXECUTED in the sandbox this project was integrated in — see
 * README.md for exactly why (no Sepolia RPC / no live FHEVM node reachable
 * from this sandbox). Contract *compilation* WAS verified for real, twice —
 * once for CairnPool.sol alone and once compiling it together with
 * MockCUSDT.sol using solc 0.8.27 (the version this repo's hardhat.config.ts
 * now pins, since ERC7984.sol itself requires ^0.8.27). Written against the
 * real, verified @fhevm/hardhat-plugin test API (fhevm.createEncryptedInput,
 * fhevm.userDecryptEuint) and ready to run wherever normal network access
 * is available: `npm install && npx hardhat test`.
 */
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { CairnPool, MockCUSDT } from "../typechain-types";

const DEFAULT_MAX_COHORT = 50;
const DEFAULT_YIELD_RATE_BPS = 300; // 3% — matches scripts/deploy.ts's default
const DEFAULT_MIN_COHORT = 1; // low, so single-participant tests can request a draw
const DEFAULT_MIN_INTERVAL = 0; // no cooldown, so tests can request draws back-to-back

const ONE_DAY = 24 * 60 * 60;

describe("CairnPool", function () {
  let pool: CairnPool;
  let poolAddress: string;
  let cusdt: MockCUSDT;
  let cusdtAddress: string;
  let deployer: any, alice: any, bob: any;

  /** Mints `amount` mock cUSDT to `user` and sets CairnPool as their operator, so deposits work. */
  async function fundAndApprove(user: any, amount: number) {
    // NOTE: the encrypted input must be created for `deployer` — the account
    // that actually calls `mint()` (it's onlyOwner) — not for `user`, the
    // token recipient. FHEVM binds a ciphertext to the (contract, signer)
    // pair given to createEncryptedInput, and that signer must equal
    // msg.sender of the tx that consumes it, regardless of who the funds
    // are ultimately credited to.
    const enc = await fhevm.createEncryptedInput(cusdtAddress, deployer.address).add64(amount).encrypt();
    await (await cusdt.connect(deployer).mint(user.address, enc.handles[0], enc.inputProof)).wait();
    await (await cusdt.connect(user).setOperator(poolAddress, Math.floor(Date.now() / 1000) + ONE_DAY)).wait();
  }

  async function decryptPrincipal(user: any) {
    const handle = await pool.connect(user).myPrincipal();
    return fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, user);
  }

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    const TokenFactory = await ethers.getContractFactory("MockCUSDT");
    cusdt = (await TokenFactory.deploy()) as unknown as MockCUSDT;
    await cusdt.waitForDeployment();
    cusdtAddress = await cusdt.getAddress();

    const Factory = await ethers.getContractFactory("CairnPool");
    pool = (await Factory.deploy(
      cusdtAddress,
      DEFAULT_MAX_COHORT,
      DEFAULT_MIN_COHORT,
      DEFAULT_MIN_INTERVAL,
      DEFAULT_YIELD_RATE_BPS,
    )) as unknown as CairnPool;
    await pool.waitForDeployment();
    poolAddress = await pool.getAddress();
  });

  describe("deposit", function () {
    it("moves real cUSDT into the pool and credits encrypted principal", async function () {
      await fundAndApprove(alice, 1_000_000);

      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();

      expect(await decryptPrincipal(alice)).to.equal(1_000_000n);

      // The pool itself should now hold the real token. We verify this via
      // alice's own wallet balance (which only alice is ACL-permitted to
      // decrypt) instead of decrypting the pool's confidential balance
      // directly: ERC7984's mint/transfer only grants FHE decrypt access to
      // the token contract itself and the balance owner — here, the
      // CairnPool *contract*, not any externally-owned account. No EOA,
      // including the deployer, is ever granted permission to decrypt a
      // balance held by a smart contract, so `deployer` trying to userDecrypt
      // the pool's balance was never going to work — this was a latent bug
      // in the test itself (this file was written but never actually run
      // until now — see the file header), not a deposit-flow bug. Alice's
      // balance landing at exactly 0 after depositing her full 1,000,000 is
      // an equally strong, and actually decryptable, proof the transfer
      // really moved the tokens into the pool.
      const aliceBalanceHandle = await cusdt.confidentialBalanceOf(alice.address);
      const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, aliceBalanceHandle, cusdtAddress, alice);
      expect(aliceBalance).to.equal(0n);
    });

    it("reverts if the caller never approved CairnPool as an operator", async function () {
      // Same rule as fundAndApprove: encrypt for `deployer` (mint's real
      // caller), not `alice` (the recipient).
      const enc = await fhevm.createEncryptedInput(cusdtAddress, deployer.address).add64(1_000_000).encrypt();
      await (await cusdt.connect(deployer).mint(alice.address, enc.handles[0], enc.inputProof)).wait();
      // deliberately skip setOperator

      const encDep = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(500_000).encrypt();
      await expect(pool.connect(alice).deposit(encDep.handles[0], encDep.inputProof)).to.be.reverted;
    });

    it("accumulates principal across multiple deposits", async function () {
      await fundAndApprove(alice, 750_000);

      const enc1 = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(500_000).encrypt();
      await (await pool.connect(alice).deposit(enc1.handles[0], enc1.inputProof)).wait();

      const enc2 = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(250_000).encrypt();
      await (await pool.connect(alice).deposit(enc2.handles[0], enc2.inputProof)).wait();

      expect(await decryptPrincipal(alice)).to.equal(750_000n);
    });

    it("NEGATIVE: an unrelated address cannot decrypt another user's principal", async function () {
      await fundAndApprove(alice, 1_000_000);
      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();

      const handle = await pool.connect(alice).myPrincipal();
      let rejected = false;
      try {
        await fhevm.userDecryptEuint(FhevmType.euint64, handle, poolAddress, bob);
      } catch {
        rejected = true;
      }
      expect(rejected).to.equal(true, "bob should NOT be able to decrypt alice's principal");
    });
  });

  describe("withdraw", function () {
    it("clamps to available principal (not reverted) and moves real cUSDT back", async function () {
      await fundAndApprove(alice, 1_000_000);
      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();

      // request withdrawing more than principal — must clamp to principal, not revert
      const encW = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(5_000_000).encrypt();
      await (await pool.connect(alice).withdraw(encW.handles[0], encW.inputProof)).wait();

      expect(await decryptPrincipal(alice)).to.equal(0n);

      const aliceBalanceHandle = await cusdt.confidentialBalanceOf(alice.address);
      const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, aliceBalanceHandle, cusdtAddress, alice);
      expect(aliceBalance).to.equal(1_000_000n); // got their full principal back, no more, no less
    });

    it("any wallet can withdraw only its own principal, never another's", async function () {
      await fundAndApprove(alice, 1_000_000);
      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();

      // bob has no position at all — withdraw must revert ("no position"), not silently succeed against alice's balance
      const encW = await fhevm.createEncryptedInput(poolAddress, bob.address).add64(1).encrypt();
      await expect(pool.connect(bob).withdraw(encW.handles[0], encW.inputProof)).to.be.reverted;
    });
  });

  describe("permissionless draw lifecycle", function () {
    it("requestDrawResolution is callable by ANY wallet, not just the deployer", async function () {
      await fundAndApprove(alice, 1_000_000);
      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();

      // alice is the only tracked participant here — she must mark herself
      // ready before ANYONE (even bob, who isn't a participant at all) can
      // successfully call requestDrawResolution(). See "readiness gate" below
      // for the dedicated test of this requirement itself.
      await (await pool.connect(alice).setReadyForDraw(true)).wait();

      // bob — who has never deposited and is not the owner — requests the draw
      const tx = await pool.connect(bob).requestDrawResolution();
      await expect(tx).to.emit(pool, "DrawTotalWeightRequested");
      expect(await pool.drawStage(0)).to.equal(1n); // DrawStage.TotalWeightRequested
    });

    it("rejects requestDrawResolution before minCohortSize participants", async function () {
      const Factory = await ethers.getContractFactory("CairnPool");
      const strictPool = (await Factory.deploy(cusdtAddress, DEFAULT_MAX_COHORT, 5, 0, DEFAULT_YIELD_RATE_BPS)) as unknown as CairnPool;
      await strictPool.waitForDeployment();
      await expect(strictPool.connect(bob).requestDrawResolution()).to.be.revertedWith("not enough participants yet");
    });

    it("self-sequences drawId (no caller-supplied drawId to collide or game)", async function () {
      await fundAndApprove(alice, 1_000_000);
      const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
      await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
      await (await pool.connect(alice).setReadyForDraw(true)).wait();

      expect(await pool.nextDrawId()).to.equal(0n);
      await (await pool.connect(bob).requestDrawResolution()).wait();
      expect(await pool.nextDrawId()).to.equal(1n);
    });

    describe("readiness gate", function () {
      it("blocks requestDrawResolution until EVERY tracked participant has marked ready", async function () {
        await fundAndApprove(alice, 1_000_000);
        const encA = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
        await (await pool.connect(alice).deposit(encA.handles[0], encA.inputProof)).wait();

        await fundAndApprove(bob, 500_000);
        const encB = await fhevm.createEncryptedInput(poolAddress, bob.address).add64(500_000).encrypt();
        await (await pool.connect(bob).deposit(encB.handles[0], encB.inputProof)).wait();

        // two tracked participants now (alice, bob) — neither ready yet
        expect(await pool.allParticipantsReady()).to.equal(false);
        await expect(pool.connect(alice).requestDrawResolution()).to.be.revertedWith("not everyone has marked ready yet");

        // only alice ready — still blocked
        await (await pool.connect(alice).setReadyForDraw(true)).wait();
        expect(await pool.readyCount()).to.equal(1n);
        expect(await pool.allParticipantsReady()).to.equal(false);
        await expect(pool.connect(bob).requestDrawResolution()).to.be.revertedWith("not everyone has marked ready yet");

        // both ready — now it succeeds, from either wallet
        await (await pool.connect(bob).setReadyForDraw(true)).wait();
        expect(await pool.allParticipantsReady()).to.equal(true);
        await expect(pool.connect(bob).requestDrawResolution()).to.emit(pool, "DrawTotalWeightRequested");
      });

      it("resets readiness for everyone once a draw actually starts", async function () {
        await fundAndApprove(alice, 1_000_000);
        const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
        await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();
        await (await pool.connect(alice).setReadyForDraw(true)).wait();

        await (await pool.connect(bob).requestDrawResolution()).wait();

        expect(await pool.readyCount()).to.equal(0n);
        expect(await pool.readyForDraw(alice.address)).to.equal(false);
        // next round requires a fresh "I'm ready" — the old signal doesn't carry over
        await expect(pool.connect(bob).requestDrawResolution()).to.be.revertedWith("not everyone has marked ready yet");
      });

      it("toggling ready twice with the same value is a harmless no-op (doesn't double-count)", async function () {
        await fundAndApprove(alice, 1_000_000);
        const enc = await fhevm.createEncryptedInput(poolAddress, alice.address).add64(1_000_000).encrypt();
        await (await pool.connect(alice).deposit(enc.handles[0], enc.inputProof)).wait();

        await (await pool.connect(alice).setReadyForDraw(true)).wait();
        await (await pool.connect(alice).setReadyForDraw(true)).wait(); // repeat, same value
        expect(await pool.readyCount()).to.equal(1n);
      });

      it("rejects setReadyForDraw from a wallet with no position", async function () {
        await expect(pool.connect(bob).setReadyForDraw(true)).to.be.revertedWith("no position");
      });
    });

    // TODO once the mock coprocessor's public-decryption callback flow is
    // exercised end-to-end: full tests for submitTotalWeight -> submitWinner
    // -> claimPrize asserting (a) resolvedWinner(drawId) is set
    // correctly, (b) the prize handle is ACL-granted only to that address,
    // (c) claimPrize reverts for a non-winner and on a second attempt by the
    // real winner, and (d) a small multi-participant pool with known weights
    // produces a winner distribution consistent with proportional selection
    // over many draws. Left as explicit TODOs rather than fabricated passing
    // assertions, since they depend on the mock relayer's decryption-proof
    // helpers, which have not been exercised in this sandbox (see README.md).
  });
});
