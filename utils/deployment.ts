import { ethers, upgrades } from "hardhat";
import { BaseContract } from "ethers";
import hre from "hardhat";

export async function deployContract(contractName: string, args: Array<any>) {
  const contractFactory = await ethers.getContractFactory(contractName);
  const contract = await contractFactory.deploy(...args);

  await contract.waitForDeployment();

  return contract;
}

export async function deployProxy(contractName: string, args: Array<any>) {
  const contractFactory = await ethers.getContractFactory(contractName);

  const contract = await upgrades.deployProxy(contractFactory, args, {
    initializer: "initialize",
  });

  await contract.waitForDeployment();

  return contract;
}

export async function upgradeProxy(contractName: string, proxyAddress: string, timeoutSec: number) {
  const contractFactory = await ethers.getContractFactory(contractName);

  const contract = await upgrades.upgradeProxy(proxyAddress, contractFactory);

  await new Promise((r) => setTimeout(r, timeoutSec * 1000));

  const newImplementationAddress = await upgrades.erc1967.getImplementationAddress(proxyAddress);

  console.log("Proxy upgraded: ", proxyAddress);
  console.log("New implementation address: ", newImplementationAddress);

  return contract;
}

export async function verifyContract(contract: BaseContract, args: Array<any>, timeoutSec: number) {
  await new Promise((r) => setTimeout(r, timeoutSec * 1000));

  try {
    await hre.run("verify:verify", {
      address: await contract.getAddress(),
      constructorArguments: args,
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
