import fs from "fs";

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-chai-matchers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer";
import "hardhat-tracer";


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
    alpha4: {
      url: "http://62.171.133.46:54100",
      accounts: {
        count: 10,
        path: "m/44'/60'/0'/0",
        mnemonic
      },

      allowUnlimitedContractSize: true,
      hardfork: "istanbul",
      minGasPrice: 1000000000
    },
    beta1: {
      //url: "http://62.171.133.46:55100",
      url: "https://beta-rpc.bit.diamonds",
      accounts: {
          mnemonic: mnemonic,
          path: "m/44'/60'/0'/0",
          initialIndex: 0,
          count: 20,
          passphrase: "",
      },
      gasPrice: 1000000000,
      hardfork: "london",
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
          evmVersion: "london"
        },
      },
    ]
  },
  contractSizer: {
    alphaSort: true,
    runOnCompile: true,
    disambiguatePaths: false,
    only: ["DiamondDao"],
    except: ["Mock"]
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
        network: "alpha3",
        chainId: 777016,
        urls: {
          apiURL: "https://explorer.uniq.diamonds/api",
          browserURL: "https://explorer.uniq.diamonds",
        },
      },
      {
        network: "dmd",
        chainId: 777012,
        urls: {
          apiURL: "https://explorer.uniq.diamonds/api",
          browserURL: "https://explorer.uniq.diamonds",
        },
      },
      {
        network: "alpha4",
        chainId: 777018,
        urls: {
            apiURL: "http://62.171.133.46:4400/api",
            browserURL: "http://62.171.133.46:4400",
        },
      },
    ],
  },
};

export default config;
