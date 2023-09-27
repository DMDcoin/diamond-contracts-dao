import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { DiamondDao } from "../typechain-types";

const EmptyBytes = ethers.hexlify(new Uint8Array());

enum ProposalState {
  Created,
  Active,
  Canceled,
  Accepted,
  Declined,
  Expired,
  Executed
};

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

    it("should not allow reinitialization", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");

      const dao = await upgrades.deployProxy(daoFactory, [
        users[1].address,
        users[2].address,
        createProposalFee
      ], {
        initializer: "initialize",
      });

      await dao.waitForDeployment();

      await expect(
        dao.initialize(
          users[1].address,
          users[2].address,
          createProposalFee
        )
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("propose", async function () {
    it("should revert propose with empty targets array", async function () {
      const { dao } = await loadFixture(deployFixture);

      const targets: string[] = [];
      const values: bigint[] = [];
      const calldatas: string[] = [];

      await expect(
        dao.propose(targets, values, calldatas, "test", { value: createProposalFee })
      ).to.be.revertedWithCustomError(dao, "InvalidArgument")
    });

    it("should revert propose with targets.length != values.length", async function () {
      const { dao } = await loadFixture(deployFixture);

      const targets = [users[1].address, users[2].address];
      const values = [1n];
      const calldatas = [EmptyBytes, EmptyBytes];

      await expect(
        dao.propose(targets, values, calldatas, "test", { value: createProposalFee })
      ).to.be.revertedWithCustomError(dao, "InvalidArgument")
    });

    it("should revert propose with targets.length != calldatas.length", async function () {
      const { dao } = await loadFixture(deployFixture);

      const targets = [users[1].address];
      const values = [1n, 1n];
      const calldatas = [EmptyBytes, EmptyBytes];

      await expect(
        dao.propose(targets, values, calldatas, "test", { value: createProposalFee })
      ).to.be.revertedWithCustomError(dao, "InvalidArgument")
    });

    it("should revert propose without proposal fee payment", async function () {
      const { dao } = await loadFixture(deployFixture);

      const targets = [users[3].address];
      const values = [1n];
      const calldatas = [EmptyBytes];

      await expect(
        dao.propose(targets, values, calldatas, "test", { value: 0n })
      ).to.be.revertedWithCustomError(dao, "InsufficientFunds")
    });

    it("should revert propose if same proposal already exists", async function () {
      const { dao } = await loadFixture(deployFixture);

      const targets = [users[3].address];
      const values = [ethers.parseEther("1")];
      const calldatas = [EmptyBytes];
      const description = "test";

      const proposalId = await dao.hashProposal(
        targets,
        values,
        calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      expect(await dao.propose(targets, values, calldatas, description, { value: createProposalFee }));

      await expect(
        dao.propose(targets, values, calldatas, description, { value: createProposalFee })
      ).to.be.revertedWithCustomError(dao, "ProposalAlreadyExist")
        .withArgs(proposalId);
    });

    it("should create proposal and transfer fee to reinsert pot", async function () {
      const { dao } = await loadFixture(deployFixture);

      const proposer = users[2];

      const targets = [users[3].address];
      const values = [ethers.parseEther("1")];
      const calldatas = [EmptyBytes];
      const description = "test";

      await expect(
        dao.connect(proposer).propose(targets, values, calldatas, description, { value: createProposalFee })
      ).to.changeEtherBalances(
        [proposer.address, reinsertPot.address],
        [-createProposalFee, createProposalFee]
      );
    });

    it("should create proposal and emit event", async function () {
      const { dao } = await loadFixture(deployFixture);

      const proposer = users[2];

      const targets = [users[3].address];
      const values = [ethers.parseEther("1")];
      const calldatas = [EmptyBytes];
      const description = "test";

      const proposalId = await dao.hashProposal(
        targets,
        values,
        calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      await expect(
        dao.connect(proposer).propose(targets, values, calldatas, description, { value: createProposalFee })
      ).to.emit(dao, "ProposalCreated")
        .withArgs(
          proposer.address,
          proposalId,
          targets,
          values,
          calldatas,
          description
        );
    });

    it("should create proposal and save data", async function () {
      const { dao } = await loadFixture(deployFixture);

      const proposer = users[2];

      const targets = [users[3].address];
      const values = [ethers.parseEther("1")];
      const calldatas = [EmptyBytes];
      const description = "test";

      const proposalId = await dao.hashProposal(
        targets,
        values,
        calldatas,
        ethers.keccak256(ethers.toUtf8Bytes(description))
      );

      expect(await dao.connect(proposer).propose(
        targets,
        values,
        calldatas,
        description,
        { value: createProposalFee }
      ));

      expect(await dao.proposalExists(proposalId)).to.be.true;

      const savedData = await dao.getProposal(proposalId);

      expect(Object.values(savedData)).to.deep.equal([
        proposer.address,
        BigInt(ProposalState.Created),
        targets,
        values,
        calldatas,
        description
      ]);
    });
  });

  describe("cancel", async function () { });

  describe("vote", async function () { });

  describe("voteWithReason", async function () { });

  describe("finalize", async function () { });

  describe("execute", async function () { });
});
