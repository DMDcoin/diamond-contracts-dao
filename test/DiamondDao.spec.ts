import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DiamondDao } from "../typechain-types";

describe("DiamondDao contract", function () {
  let users: HardhatEthersSigner[];
  let reinsertPot: HardhatEthersSigner;

  const createProposalFee = ethers.parseEther("50");

  before(async () => {
    users = await ethers.getSigners();

    reinsertPot = users[1];
  });

  async function deployFixture() {
    const daoFactory = await ethers.getContractFactory("DiamondDao");
    const mockFactory = await ethers.getContractFactory("MockValidatorSetHbbft");

    const mockValidatorSet = await mockFactory.deploy();
    await mockValidatorSet.waitForDeployment();

    const daoProxy = await upgrades.deployProxy(daoFactory, [
      await mockValidatorSet.getAddress(),
      reinsertPot.address,
      createProposalFee
    ], {
      initializer: "initialize",
    });

    await daoProxy.waitForDeployment();

    const dao = daoFactory.attach(await daoProxy.getAddress()) as DiamondDao;

    return { dao, mockValidatorSet };
  }

  describe("initializer", async function () {
    it("should not deploy contract with invalid ValidatorSet address", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");

      await expect(
        upgrades.deployProxy(daoFactory, [
          ethers.ZeroAddress,
          reinsertPot.address,
          createProposalFee
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidArgument");
    });

    it("should not deploy contract with invalid reinsert pot address", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");

      await expect(
        upgrades.deployProxy(daoFactory, [
          users[1].address,
          ethers.ZeroAddress,
          createProposalFee
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidArgument");
    });

    it("should not deploy contract with zero create proposal fee address", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");

      await expect(
        upgrades.deployProxy(daoFactory, [
          users[1].address,
          users[2].address,
          0n
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidArgument");
    });
  });

  describe("propose", async function () {
    it("should revert propose without proposal fee payment", async function () {
      const { dao } = await loadFixture(deployFixture);

      const targets = [users[3].address];
      const values = [0n];
      const calldatas = ["0x"];

      await expect(
        dao.propose(targets, values, calldatas, "test", { value: 0n })
      ).to.be.revertedWithCustomError(dao, "InsufficientFunds")
    });
  });

  describe("cancel", async function () { });

  describe("vote", async function () { });

  describe("voteWithReason", async function () { });

  describe("finalize", async function () { });

  describe("execute", async function () { });
});
