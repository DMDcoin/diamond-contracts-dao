import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

import { DiamondDao } from "../typechain-types";

const EmptyBytes = ethers.hexlify(new Uint8Array());

enum ProposalState {
  Created,
  Canceled,
  Active,
  VotingFinished,
  Accepted,
  Declined,
  Executed
};

export function getRandomBigInt(): bigint {
  let hex = "0x" + Buffer.from(ethers.randomBytes(16)).toString("hex");

  return BigInt(hex);
}

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
    const stakingFactory = await ethers.getContractFactory("MockStakingHbbft");

    const mockValidatorSet = await mockFactory.deploy();
    await mockValidatorSet.waitForDeployment();

    const mockStaking = await stakingFactory.deploy();
    await mockStaking.waitForDeployment();

    const startTime = await time.latest();

    const daoProxy = await upgrades.deployProxy(daoFactory, [
      await mockValidatorSet.getAddress(),
      await mockStaking.getAddress(),
      reinsertPot.address,
      createProposalFee,
      startTime + 1
    ], {
      initializer: "initialize",
    });

    await daoProxy.waitForDeployment();

    const dao = daoFactory.attach(await daoProxy.getAddress()) as DiamondDao;

    return { dao, mockValidatorSet, mockStaking };
  }

  async function createProposal(
    dao: DiamondDao,
    proposer: HardhatEthersSigner,
    targets?: string[],
    values?: bigint[],
    calldatas?: string[],
    description?: string
  ) {
    const _targets = targets ? targets : [users[1].address];
    const _values = values ? values : [ethers.parseEther('100')];
    const _calldatas = calldatas ? calldatas : [EmptyBytes];
    const _description = description ? description : "fund user";

    const proposalId = await dao.hashProposal(
      _targets,
      _values,
      _calldatas,
      ethers.keccak256(ethers.toUtf8Bytes(_description))
    );

    await dao.connect(proposer).propose(
      _targets,
      _values,
      _calldatas,
      _description,
      { value: createProposalFee }
    );

    return { proposalId, targets, values, calldatas, description }
  }

  describe("initializer", async function () {
    it("should not deploy contract with invalid ValidatorSet address", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");
      const startTime = await time.latest();

      await expect(
        upgrades.deployProxy(daoFactory, [
          ethers.ZeroAddress,
          users[1].address,
          users[2].address,
          createProposalFee,
          startTime + 1
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidArgument");
    });

    it("should not deploy contract with invalid StakingHbbft address", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");
      const startTime = await time.latest();

      await expect(
        upgrades.deployProxy(daoFactory, [
          users[1].address,
          ethers.ZeroAddress,
          users[2].address,
          createProposalFee,
          startTime + 1
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidArgument");
    });

    it("should not deploy contract with invalid reinsert pot address", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");
      const startTime = await time.latest();

      await expect(
        upgrades.deployProxy(daoFactory, [
          users[1].address,
          users[2].address,
          ethers.ZeroAddress,
          createProposalFee,
          startTime + 1
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidArgument");
    });

    it("should not deploy contract with zero create proposal fee address", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");
      const startTime = await time.latest();

      await expect(
        upgrades.deployProxy(daoFactory, [
          users[1].address,
          users[2].address,
          users[3].address,
          0n,
          startTime + 1
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidArgument");
    });

    it("should not deploy contract with invalid start timestamp", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");
      const startTime = await time.latest();

      await expect(
        upgrades.deployProxy(daoFactory, [
          users[1].address,
          users[2].address,
          users[3].address,
          createProposalFee,
          startTime - 10
        ], {
          initializer: "initialize",
        })
      ).to.be.revertedWithCustomError(daoFactory, "InvalidStartTimestamp");
    });

    it("should not allow reinitialization", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");
      const startTime = await time.latest();

      const dao = await upgrades.deployProxy(daoFactory, [
        users[1].address,
        users[2].address,
        users[3].address,
        createProposalFee,
        startTime + 1
      ], {
        initializer: "initialize",
      });

      await dao.waitForDeployment();

      await expect(
        dao.initialize(
          users[1].address,
          users[2].address,
          users[3].address,
          createProposalFee,
          startTime + 1
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

    it("should revert propose if fee transfer failed", async function () {
      const daoFactory = await ethers.getContractFactory("DiamondDao");
      const mockFactory = await ethers.getContractFactory("MockValidatorSetHbbft");

      const mockValidatorSet = await mockFactory.deploy();
      await mockValidatorSet.waitForDeployment();

      const startTime = await time.latest();

      const daoProxy = await upgrades.deployProxy(daoFactory, [
        await mockValidatorSet.getAddress(),
        await mockValidatorSet.getAddress(),
        await mockValidatorSet.getAddress(),
        createProposalFee,
        startTime + 1
      ], {
        initializer: "initialize",
      });

      await daoProxy.waitForDeployment();

      const dao = daoFactory.attach(await daoProxy.getAddress()) as DiamondDao;

      const targets = [users[3].address];
      const values = [ethers.parseEther("1")];
      const calldatas = [EmptyBytes];
      const description = "test";

      await expect(
        dao.propose(
          targets,
          values,
          calldatas,
          description,
          { value: createProposalFee }
        )
      ).to.be.revertedWithCustomError(dao, "TransferFailed")
        .withArgs(await dao.getAddress(), await mockValidatorSet.getAddress(), createProposalFee);
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

    it("should create proposal and update statistical data", async function () {
      const { dao } = await loadFixture(deployFixture);

      const statisticsBefore = await dao.statistic();

      const proposer = users[1];
      await createProposal(dao, proposer);

      const statisticsAfter = await dao.statistic();
      expect(statisticsAfter.total).to.equal(statisticsBefore.total + 1n);
    });
  });

  describe("cancel", async function () {
    it("should revert cancel for non-existing proposal", async function () {
      const { dao } = await loadFixture(deployFixture);

      const nonExistingProposalId = getRandomBigInt();

      await expect(
        dao.cancel(nonExistingProposalId, "test")
      ).to.be.revertedWithCustomError(dao, "ProposalNotExist")
        .withArgs(nonExistingProposalId);
    });

    it("should revert cancel not by proposal creator", async function () {
      const { dao } = await loadFixture(deployFixture);

      const proposer = users[1];
      const caller = users[2];

      const { proposalId } = await createProposal(dao, proposer);

      await expect(
        dao.connect(caller).cancel(proposalId, "test")
      ).to.be.revertedWithCustomError(dao, "OnlyProposer");
    });

    it("should cancel proposal and emit event", async function () {
      const { dao } = await loadFixture(deployFixture);

      const proposer = users[1];
      const reason = "proposal-cancel-reason";

      const { proposalId } = await createProposal(dao, proposer);

      await expect(
        dao.connect(proposer).cancel(proposalId, reason)
      ).to.emit(dao, "ProposalCanceled")
        .withArgs(proposer.address, proposalId, reason);
    });

    it("should cancel proposal and change its status to canceled", async function () {
      const { dao } = await loadFixture(deployFixture);

      const proposer = users[1];
      const { proposalId } = await createProposal(dao, proposer);

      let proposalData = await dao.getProposal(proposalId);
      expect(proposalData.state).to.be.equal(ProposalState.Created);

      expect(await dao.connect(proposer).cancel(proposalId, "reason"));

      proposalData = await dao.getProposal(proposalId);
      expect(proposalData.state).to.be.equal(ProposalState.Canceled);
    });

    it("should cancel proposal and update statistics", async function () {
      const { dao } = await loadFixture(deployFixture);

      const proposer = users[1];
      const { proposalId } = await createProposal(dao, proposer);

      const statisticsBefore = await dao.statistic();

      expect(await dao.connect(proposer).cancel(proposalId, "reason"));

      const statisticsAfter = await dao.statistic();
      expect(statisticsAfter.canceled).to.be.equal(statisticsBefore.canceled + 1n);
    });
  });

  describe("vote", async function () { });

  describe("voteWithReason", async function () { });

  describe("finalize", async function () { });

  describe("execute", async function () { });
});
