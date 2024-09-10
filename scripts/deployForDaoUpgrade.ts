import { ethers } from "hardhat";


async function deploy() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying from: ", deployer.address);
  console.log("Deploying DiamondDao contract");

  const contractFactory = await ethers.getContractFactory("DiamondDao");

  let deployed = await contractFactory.deploy();
  //await dao.waitForDeployment();

  console.log("DiamondDao deployed at: ", await deployed.getAddress());
  console.log("Done.");
}

deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
