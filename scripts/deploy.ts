import { ethers } from "hardhat";
import { deployProxy } from "../utils/deployment";


async function deploy() {
  const [deployer] = await ethers.getSigners();

  const createProposalFee = ethers.parseEther('1');
  const latestBlock = await ethers.provider.getBlock("latest");
  const startTimestamp = latestBlock!.timestamp + 300;

  console.log("Deploying from: ", deployer.address);
  console.log("Deploying DiamondDao contract");

  const dao = await deployProxy("DiamondDao", [
    "0x1000000000000000000000000000000000000001", // ValidatorSetHbbf
    "0x1100000000000000000000000000000000000001", // StakingHbbft
    "0x2000000000000000000000000000000000000001", // _reinsertPot
    "0x4000000000000000000000000000000000000001", // _txPermission,
    createProposalFee,
    startTimestamp,
  ]);

  await dao.waitForDeployment();

  console.log("DiamondDao deployed at: ", await dao.getAddress());
  console.log("Done.");
}

deploy().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
