import { setDefaultResultOrder } from "node:dns";
// Node's fetch/undici (unlike curl, which does Happy Eyeballs) will happily
// pick an IPv6 address if the DNS response offers one and then hang until
// its connect timeout if that route is dead or throttled — a very common
// failure mode on networks/ISPs with partial or broken IPv6. Forcing
// ipv4first here makes every RPC/relayer call in this project (deploy,
// fundYieldSource, tests, hardhat's own fhevm plugin calls) resolve the
// same way curl already does by default in most environments.
setDefaultResultOrder("ipv4first");

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@fhevm/hardhat-plugin";
import * as dotenv from "dotenv";

dotenv.config({ path: "./config/.env" });

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL ?? "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Required: submitTotalWeight() has enough local variables (FHE
      // handles, loop state, the yield-accrual math) to hit Solidity's
      // "stack too deep" limit under the legacy codegen pipeline. viaIR
      // fixes this without restructuring the function's logic.
      viaIR: true,
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: { count: 60 },
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId: 11155111,
    },
  },
};

export default config;

