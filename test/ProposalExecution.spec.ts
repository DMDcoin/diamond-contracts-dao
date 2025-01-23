import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { attachProxyAdminV5 } from "@openzeppelin/hardhat-upgrades/dist/utils";

import { DiamondDao, MockStakingHbbft, MockValidatorSetHbbft } from "../typechain-types";

const EmptyBytes = ethers.hexlify(new Uint8Array());

enum Vote {
  Abstain,
  No,
  Yes
}

export function getRandomBigInt(): bigint {
  let hex = "0x" + Buffer.from(ethers.randomBytes(16)).toString("hex");

  return BigInt(hex);
}

describe("DAO proposal execution", function () {
  let users: HardhatEthersSigner[];
  let reinsertPot: HardhatEthersSigner;

  const createProposalFee = ethers.parseEther("10");
  const governancePotValue = ethers.parseEther('500');

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

    const mockStaking = await stakingFactory.deploy(await mockValidatorSet.getAddress());
    await mockStaking.waitForDeployment();

    const startTime = await time.latest();

    const daoProxy = await upgrades.deployProxy(daoFactory, [
      users[0].address,
      await mockValidatorSet.getAddress(),
      await mockStaking.getAddress(),
      reinsertPot.address,
      ethers.ZeroAddress,
      createProposalFee,
      startTime + 10
    ], {
      initializer: "initialize",
    });

    await daoProxy.waitForDeployment();

    const dao = daoFactory.attach(await daoProxy.getAddress()) as DiamondDao;

    await users[0].sendTransaction({
      value: governancePotValue,
      to: await dao.getAddress()
    });

    return { dao, mockValidatorSet, mockStaking };
  }

  async function createProposal(
    dao: DiamondDao,
    proposer: HardhatEthersSigner,
    description?: string,
    targets?: string[],
    values?: bigint[],
    calldatas?: string[]
  ) {
    const _targets = targets ? targets : [users[1].address];
    const _values = values ? values : [ethers.parseEther('50')];
    const _calldatas = calldatas ? calldatas : [EmptyBytes];
    const _description = description ? description : "fund user";

    const proposalId = await dao.hashProposal(
      _targets,
      _values,
      _calldatas,
      _description
    );

    await dao.connect(proposer).propose(
      _targets,
      _values,
      _calldatas,
      "title",
      _description,
      "url",
      { value: createProposalFee }
    );

    return { proposalId, targets, values, calldatas, description }
  }

  async function swithPhase(dao: DiamondDao) {
    const phase = await dao.daoPhase();
    await time.increaseTo(phase.end + 1n);

    await dao.switchPhase();
  }

  async function addValidatorsStake(
    validatorSet: MockValidatorSetHbbft,
    staking: MockStakingHbbft,
    validators: HardhatEthersSigner[],
    stakeAmount?: bigint
  ): Promise<void> {
    const stake = stakeAmount ? stakeAmount : ethers.parseEther('10');

    for (const validator of validators) {
      await validatorSet.add(validator.address, validator.address, true);
      await staking.setStake(validator.address, stake);
    }
  }

  async function vote(
    dao: DiamondDao,
    proposalId: bigint,
    voters: HardhatEthersSigner[],
    vote: Vote
  ): Promise<void> {
    for (const voter of voters) {
      await dao.connect(voter).vote(proposalId, vote);
    }
  }

  async function finalizedProposal(
    dao: DiamondDao,
    mockValidatorSet: MockValidatorSetHbbft,
    mockStaking: MockStakingHbbft,
    _vote: Vote,
    targets?: string[],
    values?: bigint[],
    calldatas?: string[]
  ) {
    const proposer = users[2];
    const voters = users.slice(10, 25);

    const { proposalId } = await createProposal(
      dao,
      proposer,
      getRandomBigInt().toString(),
      targets,
      values,
      calldatas
    );

    await swithPhase(dao);
    await addValidatorsStake(mockValidatorSet, mockStaking, voters);
    await vote(dao, proposalId, voters, _vote);

    await swithPhase(dao);

    await dao.finalize(proposalId);

    return { proposalId, proposer };
  }

  describe("self function calls", async function () {
    it("should not allow to set createProposalFee = 0", async function () {
      const proposer = users[2];
      const { dao } = await loadFixture(deployFixture);

      const newVal = 0n;
      const calldata = dao.interface.encodeFunctionData("setCreateProposalFee", [newVal]);

      await expect(dao.connect(proposer).propose(
        [await dao.getAddress()],
        [0n],
        [calldata],
        "title",
        "test",
        "url",
        { value: createProposalFee }
      )).to.be.revertedWithCustomError(dao, "NewValueOutOfRange").withArgs(newVal);
    });

    it("should update createProposalFee using proposal", async function () {
      const proposer = users[2];
      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);
      const newFeeValue = ethers.parseEther('20');
      const calldata = dao.interface.encodeFunctionData("setCreateProposalFee", [newFeeValue]);

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [await dao.getAddress()],
        [0n],
        [calldata]
      );

      await expect(dao.connect(proposer).execute(proposalId))
        .to.emit(dao, "SetCreateProposalFee")
        .withArgs(newFeeValue);

      expect(await dao.createProposalFee()).to.equal(newFeeValue);
    });

    it("should update createProposalFee and refund original fee to proposers", async function () {
      const firstProposer = users[2];
      const secondProposer = users[3];
      const voters = users.slice(5, 15);

      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const originalFeeValue = createProposalFee;
      const newFeeValue = ethers.parseEther('20');
      const calldata = dao.interface.encodeFunctionData("setCreateProposalFee", [newFeeValue]);

      const { proposalId: firstProposalId } = await createProposal(
        dao,
        firstProposer,
        getRandomBigInt().toString(),
        [await dao.getAddress()],
        [0n],
        [calldata]
      );

      const { proposalId: secondProposalId } = await createProposal(
        dao,
        secondProposer,
        getRandomBigInt().toString(),
        [await dao.getAddress()],
        [0n],
        [calldata]
      );      

      await addValidatorsStake(mockValidatorSet, mockStaking, voters);
      await swithPhase(dao);
      await vote(dao, firstProposalId, voters, Vote.Yes);
      await vote(dao, secondProposalId, voters, Vote.Yes);
      await swithPhase(dao);

      await expect(
        await dao.finalize(firstProposalId)
      ).to.changeEtherBalances(
        [await dao.getAddress(), firstProposer.address],
        [-originalFeeValue, originalFeeValue]
      );

      await expect(dao.connect(firstProposer).execute(firstProposalId))
        .to.emit(dao, "SetCreateProposalFee")
        .withArgs(newFeeValue);

      expect(await dao.createProposalFee()).to.equal(newFeeValue);

      // even after fee is changed the user should get his original fee back\
      await expect(
        await dao.finalize(secondProposalId)
      ).to.changeEtherBalances(
        [await dao.getAddress(), secondProposer.address],
        [-originalFeeValue, originalFeeValue]
      );
    });
  });

  describe("self upgrade", async function () {
    it("should perform DAO self upgrade", async function () {
      const proposer = users[2];
      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const daoAddress = await dao.getAddress();
      // const proxyAdmin = await upgrades.admin.getInstance();

      const proxyAdmin = await attachProxyAdminV5(
        hre,
        await upgrades.erc1967.getAdminAddress(daoAddress)
      );

      await proxyAdmin.transferOwnership(daoAddress);
      expect(await proxyAdmin.owner()).to.equal(daoAddress);

      const factory = await ethers.getContractFactory("DiamondDao");
      const newImplementation = await upgrades.deployImplementation(factory);

      expect(daoAddress).to.not.equal(newImplementation);

      const calldata = proxyAdmin.interface.encodeFunctionData("upgradeAndCall", [
        daoAddress,
        newImplementation,
        EmptyBytes,
      ]);

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [await proxyAdmin.getAddress()],
        [0n],
        [calldata]
      );

      await expect(dao.connect(proposer).execute(proposalId))
        .to.emit(dao, "ProposalExecuted")
        .withArgs(proposer.address, proposalId);

      expect(await upgrades.erc1967.getImplementationAddress(daoAddress)).to.equal(newImplementation);
    });
  });

  describe("funds transfer from governance pot", async function () {
    it("should revert funding with insufficient governance pot balance", async function () {
      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const fundsRequest = governancePotValue * 2n;
      const fundsReceiver = users[12];

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [fundsReceiver.address],
        [fundsRequest],
        [EmptyBytes]
      );

      await expect(dao.execute(proposalId)).to.be.revertedWithCustomError(dao, "FailedInnerCall");
    });

    it("should transfer funds from governance pot and confirm Open proposalType", async function () {
      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const fundsRequest = governancePotValue;
      const fundsReceiver = users[12];

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [fundsReceiver.address],
        [fundsRequest],
        [EmptyBytes]
      );

      expect((await dao.getProposal(proposalId)).proposalType).to.equal(0);

      await expect(dao.execute(proposalId))
        .to.changeEtherBalances(
          [await dao.getAddress(), fundsReceiver.address],
          [-fundsRequest, fundsRequest]
        );
    });
  });

  describe("reentrancy protection", async function () {
    it("should revert reentrant calls to execute", async function () {
      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const attackerFactory = await ethers.getContractFactory("ReentrancyAttacker");
      const attacker = await attackerFactory.deploy(await dao.getAddress());

      await attacker.waitForDeployment();

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [await attacker.getAddress()],
        [ethers.parseEther('50')],
        [EmptyBytes]
      );

      await attacker.setId(proposalId);

      await expect(attacker.attack()).to.be.revertedWithCustomError(dao, "ReentrancyGuardReentrantCall");
    });
  });
});
