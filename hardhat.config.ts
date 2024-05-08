import fs from "fs";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-tracer";
import "solidity-coverage";


let mnemonic = 'inspire school random normal account steel strike shove close album produce cube bounce memory before';
if (fs.existsSync(".mnemonic")) {
  mnemonic = fs.readFileSync(".mnemonic").toString().trim();
}

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      accounts: {
        count: 100,
        mnemonic,
        accountsBalance: "1000000000000000000000000000"
      },
      allowUnlimitedContractSize: true,
      hardfork: "istanbul",
      gasPrice: 0
    },
    dmd: {
      url: "https://rpc.uniq.diamonds/",
      chainId: 777012,
      gasPrice: 1000000000, // 1 gwei
      accounts: {
        mnemonic: mnemonic
      }
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.8.25",
        settings: {
          optimizer: {
            enabled: true,
            runs: 800,
            details: {
              yul: true,
            },
          },
          evmVersion: "istanbul"
        },
      },
    ]
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
    only: [":DiamondDao"],
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts",
    tests: "./test",
  },
  typechain: {
    target: "ethers-v6",
  },
  etherscan: {
    apiKey: "123",
    customChains: [
      {
        network: "dmd",
        chainId: 777012,
        urls: {
          apiURL: "https://explorer.uniq.diamonds/api",
          browserURL: "https://explorer.uniq.diamonds",
        },
      },
    ],
  },
};

export default config;
