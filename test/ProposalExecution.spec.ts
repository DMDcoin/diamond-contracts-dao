import hre from "hardhat";
import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, setBalance, time } from "@nomicfoundation/hardhat-network-helpers";
import { attachProxyAdminV5 } from "@openzeppelin/hardhat-upgrades/dist/utils";

import { DiamondDao, MockDiamondDaoLowMajority, MockStakingHbbft, MockValidatorSetHbbft } from "../typechain-types";
import { createProposal, OpenProposalMajority, ProposalState, ProposalType, Vote } from "./fixture/proposal";
import { EmptyBytes, getRandomBigInt } from "./fixture/utils";

describe("DAO proposal execution", function () {
  let users: HardhatEthersSigner[];
  let owner: HardhatEthersSigner;
  let reinsertPot: HardhatEthersSigner;

  const createProposalFee = ethers.parseEther("10");
  const governancePotValue = ethers.parseEther('500');

  before(async () => {
    const signers = await ethers.getSigners();

    owner = signers[0];
    reinsertPot = signers[1];

    users = signers.slice(2);
  });

  async function deployFixture() {
    const daoFactory = await ethers.getContractFactory("DiamondDao");
    const mockFactory = await ethers.getContractFactory("MockValidatorSetHbbft");
    const stakingFactory = await ethers.getContractFactory("MockStakingHbbft");

    const mockValidatorSet = await mockFactory.deploy();
    await mockValidatorSet.waitForDeployment();

    const mockStaking = await stakingFactory.deploy(await mockValidatorSet.getAddress());
    await mockStaking.waitForDeployment();

    const mockTxPermission = ethers.Wallet.createRandom().address;

    const daoLowMajorityFactory = await ethers.getContractFactory("MockDiamondDaoLowMajority");
    const daoLowMajority = await upgrades.deployProxy(
      daoLowMajorityFactory,
      [owner.address],
      { initializer: 'initialize' }
    ) as unknown as MockDiamondDaoLowMajority;

    await daoLowMajority.waitForDeployment();

    const startTime = await time.latest();

    const dao = (await upgrades.deployProxy(daoFactory, [
      owner.address,
      await mockValidatorSet.getAddress(),
      await mockStaking.getAddress(),
      reinsertPot.address,
      mockTxPermission,
      await daoLowMajority.getAddress(),
      createProposalFee,
      startTime + 10
    ], {
      initializer: "initialize",
    })) as unknown as DiamondDao;

    await dao.waitForDeployment();

    await daoLowMajority.setMainDaoAddress(await dao.getAddress());

    await setBalance(owner.address, governancePotValue * 10n);

    await owner.sendTransaction({
      value: governancePotValue,
      to: await dao.getAddress()
    });

    await owner.sendTransaction({
      value: governancePotValue,
      to: await daoLowMajority.getAddress()
    });

    return { dao, daoLowMajority, mockValidatorSet, mockStaking };
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
      {
        description: getRandomBigInt().toString(),
        targets: targets,
        values: values,
        calldatas: calldatas,
        createProposalFee: createProposalFee,
      }
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
        OpenProposalMajority.Low,
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
        {
          description: getRandomBigInt().toString(),
          targets: [await dao.getAddress()],
          values: [0n],
          calldatas: [calldata],
          createProposalFee: createProposalFee,
        }
      );

      const { proposalId: secondProposalId } = await createProposal(
        dao,
        secondProposer,
        {
          description: getRandomBigInt().toString(),
          targets: [await dao.getAddress()],
          values: [0n],
          calldatas: [calldata],
          createProposalFee: createProposalFee,
        }
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

      const { proposalId, proposer } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [fundsReceiver.address],
        [fundsRequest],
        [EmptyBytes]
      );

      await expect(dao.connect(proposer).execute(proposalId))
        .to.be.revertedWithCustomError(dao, "FailedInnerCall");
    });

    it("should transfer funds from governance pot and confirm Open proposalType", async function () {
      const { dao, daoLowMajority, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

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
          [await daoLowMajority.getAddress(), fundsReceiver.address],
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

  describe("open proposal with low majority", async function () {
    it("should transfer funds from low majority dao pot", async function () {
      const { dao, daoLowMajority, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const fundsRequest = governancePotValue;
      const fundsReceiver = users[12];

      const proposer = users[2];
      const votersYes = users.slice(10, 20); // 10
      const votersNo = users.slice(20, 25);  // 5

      const { proposalId } = await createProposal(
        dao,
        proposer,
        {
          description: getRandomBigInt().toString(),
          targets: [fundsReceiver.address],
          values: [fundsRequest],
          calldatas: [EmptyBytes],
          majority: OpenProposalMajority.Low,
          createProposalFee: createProposalFee,
        }
      );

      await swithPhase(dao);
      await addValidatorsStake(mockValidatorSet, mockStaking, [...votersYes, ...votersNo]);
      await vote(dao, proposalId, votersYes, Vote.Yes);
      await vote(dao, proposalId, votersNo, Vote.No);

      await swithPhase(dao);

      await dao.finalize(proposalId);

      expect((await dao.getProposal(proposalId)).proposalType).to.equal(ProposalType.OpenLowMajority);

      const mainDaoBalanceBefore = await ethers.provider.getBalance(await dao.getAddress());

      await expect(dao.execute(proposalId))
        .to.changeEtherBalances(
          [await daoLowMajority.getAddress(), fundsReceiver.address],
          [-fundsRequest, fundsRequest]
        );

      expect(await ethers.provider.getBalance(await dao.getAddress())).to.eq(mainDaoBalanceBefore);
    });
    
    it("should decline proposal if low majority quorum not reached", async function () {
      const { dao, daoLowMajority, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const fundsRequest = governancePotValue;
      const fundsReceiver = users[12];

      const proposer = users[2];
      const votersYes = users.slice(10, 19); // 9
      const votersNo = users.slice(19, 25);  // 6

      const { proposalId } = await createProposal(
        dao,
        proposer,
        {
          description: getRandomBigInt().toString(),
          targets: [fundsReceiver.address],
          values: [fundsRequest],
          calldatas: [EmptyBytes],
          majority: OpenProposalMajority.Low,
          createProposalFee: createProposalFee,
        }
      );

      await swithPhase(dao);
      await addValidatorsStake(mockValidatorSet, mockStaking, [...votersYes, ...votersNo]);
      await vote(dao, proposalId, votersYes, Vote.Yes);
      await vote(dao, proposalId, votersNo, Vote.No);

      await swithPhase(dao);

      await dao.finalize(proposalId);

      const proposalData = await dao.getProposal(proposalId);

      expect(proposalData.proposalType).to.equal(ProposalType.OpenLowMajority);
      expect(proposalData.state).to.equal(ProposalState.Declined);

      const mainDaoBalanceBefore = await ethers.provider.getBalance(await dao.getAddress());
      const lowMajorityDaoBalanceBefore = await ethers.provider.getBalance(await daoLowMajority.getAddress());

      await expect(dao.execute(proposalId))
        .to.be.revertedWithCustomError(dao, "UnexpectedProposalState")
        .withArgs(proposalId, ProposalState.Declined);

      expect(await ethers.provider.getBalance(await dao.getAddress())).to.eq(mainDaoBalanceBefore);
      expect(await ethers.provider.getBalance(await daoLowMajority.getAddress())).to.eq(lowMajorityDaoBalanceBefore);
    });
  });

  describe("open proposal with high majority", async function () {
    it("should transfer funds from high majority dao pot", async function () {
      const { dao, daoLowMajority, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const fundsRequest = governancePotValue;
      const fundsReceiver = users[12];

      const proposer = users[2];
      const votersYes = users.slice(10, 22); // 12
      const votersNo = users.slice(22, 25);  // 3

      const { proposalId } = await createProposal(
        dao,
        proposer,
        {
          description: getRandomBigInt().toString(),
          targets: [fundsReceiver.address],
          values: [fundsRequest],
          calldatas: [EmptyBytes],
          majority: OpenProposalMajority.High,
          createProposalFee: createProposalFee,
        }
      );

      await swithPhase(dao);
      await addValidatorsStake(mockValidatorSet, mockStaking, [...votersYes, ...votersNo]);
      await vote(dao, proposalId, votersYes, Vote.Yes);
      await vote(dao, proposalId, votersNo, Vote.No);

      await swithPhase(dao);
      await dao.finalize(proposalId);

      expect((await dao.getProposal(proposalId)).proposalType).to.equal(ProposalType.OpenHighMajority);

      const lowMajorityDaoBalanceBefore = await ethers.provider.getBalance(await daoLowMajority.getAddress());

      await expect(dao.execute(proposalId))
        .to.changeEtherBalances(
          [await dao.getAddress(), fundsReceiver.address],
          [-fundsRequest, fundsRequest]
        );

      expect(await ethers.provider.getBalance(await daoLowMajority.getAddress())).to.eq(lowMajorityDaoBalanceBefore);
    });
    
    it("should decline proposal if low majority quorum not reached", async function () {
      const { dao, daoLowMajority, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const fundsRequest = governancePotValue;
      const fundsReceiver = users[12];

      const proposer = users[2];
      const votersYes = users.slice(10, 21); // 11
      const votersNo = users.slice(21, 25);  // 4

      const { proposalId } = await createProposal(
        dao,
        proposer,
        {
          description: getRandomBigInt().toString(),
          targets: [fundsReceiver.address],
          values: [fundsRequest],
          calldatas: [EmptyBytes],
          majority: OpenProposalMajority.High,
          createProposalFee: createProposalFee,
        }
      );

      await swithPhase(dao);
      await addValidatorsStake(mockValidatorSet, mockStaking, [...votersYes, ...votersNo]);
      await vote(dao, proposalId, votersYes, Vote.Yes);
      await vote(dao, proposalId, votersNo, Vote.No);

      await swithPhase(dao);
      await dao.finalize(proposalId);

      const proposalData = await dao.getProposal(proposalId);

      expect(proposalData.proposalType).to.equal(ProposalType.OpenHighMajority);
      expect(proposalData.state).to.equal(ProposalState.Declined);

      const mainDaoBalanceBefore = await ethers.provider.getBalance(await dao.getAddress());
      const lowMajorityDaoBalanceBefore = await ethers.provider.getBalance(await daoLowMajority.getAddress());

      await expect(dao.execute(proposalId))
        .to.be.revertedWithCustomError(dao, "UnexpectedProposalState")
        .withArgs(proposalId, ProposalState.Declined);

      expect(await ethers.provider.getBalance(await dao.getAddress())).to.eq(mainDaoBalanceBefore);
      expect(await ethers.provider.getBalance(await daoLowMajority.getAddress())).to.eq(lowMajorityDaoBalanceBefore);
    });
  });
});
