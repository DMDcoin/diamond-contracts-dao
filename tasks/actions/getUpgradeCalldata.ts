import fs from "node:fs";

import type { NewTaskActionFunction } from "hardhat/types/tasks";
import { encodeFunctionData, type Hex } from "viem";

import { requireKnownContract } from "../knownContracts.js";
import { getProxyAdminAddress } from "../helpers.js";

type GetUpgradeCalldataArgs = {
  contract: string;
  output?: string;
  impl?: string;
  initFunc?: string;
  initArgs: string[];
};

const getUpgradeCalldata: NewTaskActionFunction<GetUpgradeCalldataArgs> = async (
  { contract, output, impl, initFunc, initArgs },
  hre,
) => {
  requireKnownContract(contract);

  const { viem } = await hre.network.getOrCreate();
  const publicClient = await viem.getPublicClient();
  const [deployer] = await viem.getWalletClients();

  console.log("using address for deployment: ", deployer.account.address);

  const proxyAddress = requireKnownContract(contract);

  let implementationAddress = impl as Hex | undefined;
  let implementationAbi;

  if (implementationAddress === undefined) {
    const implementation = await viem.deployContract(contract);
    implementationAddress = implementation.address;
    implementationAbi = implementation.abi;
  } else {
    const implementation = await viem.getContractAt(contract, implementationAddress);
    implementationAbi = implementation.abi;
  }

  let initCalldata: Hex = "0x";
  if (initFunc !== undefined) {
    initCalldata = encodeFunctionData({
      abi: implementationAbi,
      functionName: initFunc as never,
      args: initArgs as never,
    });
  }

  const proxyAdminAddress = await getProxyAdminAddress(publicClient, proxyAddress);
  const proxyAdmin = await viem.getContractAt("ProxyAdmin", proxyAdminAddress);

  const calldata = encodeFunctionData({
    abi: proxyAdmin.abi,
    functionName: "upgradeAndCall",
    args: [proxyAddress, implementationAddress!, initCalldata],
  });

  const data =
    `contract: ${contract}\n` +
    `calldata: ${calldata}\n` +
    `  target: ${proxyAdminAddress}\n`;

  if (output !== undefined) {
    fs.writeFileSync(output, data, { flag: "a" });
  }

  console.log(data);
};

export default getUpgradeCalldata;
