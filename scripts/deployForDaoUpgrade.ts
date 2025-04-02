import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers } from "hardhat";

async function deployDaoContract(name: string, deployer: HardhatEthersSigner) {
  console.log(`Deploying ${name} contract`);

  const factory = await ethers.getContractFactory(name, deployer);
  const deployedContract = await factory.deploy();

  console.log(`${name} deployed at: ${await deployedContract.getAddress()}`);
}

async function deploy() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying from: ", deployer.address);

  await deployDaoContract("DiamondDaoLowMajority", deployer);
  await deployDaoContract("DiamondDao", deployer);

  console.log("Done.");
}

deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
