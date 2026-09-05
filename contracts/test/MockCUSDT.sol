// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/**
 * @title MockCUSDT
 * @notice TEST-ONLY mintable/burnable ERC-7984 token, modeled directly on
 * OpenZeppelin's own "Privileged Minter/Burner" documentation example
 * (docs.openzeppelin.com/confidential-contracts/token) — not a production
 * cUSDT. A real deployment must point CairnPool at the OFFICIAL Sepolia
 * cUSDT wrapper from Zama's Confidential Token Wrappers Registry instead —
 * see docs/DEPLOYMENT.md. This contract exists solely so
 * test/CairnPool.deposit.test.ts can exercise real confidentialTransfer/
 * confidentialTransferFrom flows locally without depending on the real
 * registry being reachable from a test environment.
 */
contract MockCUSDT is ZamaEthereumConfig, ERC7984, Ownable {
    constructor() ERC7984("Mock Confidential USDT", "cUSDT", "") Ownable(msg.sender) {}

    function mint(address to, externalEuint64 amount, bytes memory inputProof) public onlyOwner {
        euint64 minted = FHE.fromExternal(amount, inputProof);
        _mint(to, minted);
    }
}
