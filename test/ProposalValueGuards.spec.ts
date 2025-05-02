import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, setBalance, time } from "@nomicfoundation/hardhat-network-helpers";

import { DiamondDao, MockDiamondDaoLowMajority, MockStakingHbbft, MockValidatorSetHbbft } from "../typechain-types";
import { getRandomBigInt } from "./fixture/utils";
import { createProposal, OpenProposalMajority, Vote } from "./fixture/proposal";


describe("DAO Ecosystem Paramater Change Value Guards Test", function () {
  let users: HardhatEthersSigner[];
  let owner: HardhatEthersSigner;
  let reinsertPot: HardhatEthersSigner;

  let dao: DiamondDao;
  let mockValidatorSet: MockValidatorSetHbbft;
  let mockStaking: MockStakingHbbft;

  const createProposalFee = ethers.parseEther("10");
  const governancePotValue = ethers.parseEther('500');

  before(async () => {
    const signers = await ethers.getSigners();

    owner = signers[0]
    reinsertPot = signers[1];

    users = signers.slice(2);

    ({ dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture));
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

  describe("proposal Value Guards", async function () {
    it("should set staking contract as isCoreContract", async function () {
      const proposer = users[2];
      const calldata = dao.interface.encodeFunctionData("setIsCoreContract", [await mockStaking.getAddress(), true]);

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [await dao.getAddress()],
        [0n],
        [calldata]
      );

      await expect(dao.connect(proposer).execute(proposalId)).to.emit(dao, "SetIsCoreContract").withArgs(await mockStaking.getAddress(), true);
    });

    it("should fail to propose as ecosystem parameter change", async function () {
      const newVal = '50000000000000000000';
      const calldata = mockStaking.interface.encodeFunctionData("setDelegatorMinStake", [newVal]);

      const targets = [await mockStaking.getAddress()];
      const values = [0n];
      const calldatas = [calldata];

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        targets,
        values,
        calldatas
      );

      expect((await dao.getProposal(proposalId)).proposalType).to.equal(1);
    });

    it("should set setChangeAbleParameters", async function () {
      const setter = "setDelegatorMinStake(uint256)"
      const getter = "delegatorMinStake()"
      const params = [
        "50000000000000000000",
        "100000000000000000000",
        "150000000000000000000",
        "200000000000000000000",
        "250000000000000000000",
      ]

      await expect(mockStaking.setAllowedChangeableParameter(
        setter,
        getter,
        params
      )).to.emit(mockStaking, "SetChangeAbleParameter").withArgs(
        setter,
        getter,
        params
      );
    });

    it("should fail to propose ecosystem parameter change as invalid upgrade value", async function () {
      const proposer = users[2];
      const newVal = '200000000000000000000';
      const calldata = mockStaking.interface.encodeFunctionData("setDelegatorMinStake", [newVal]);

      const targets = [await mockStaking.getAddress()];
      const values = [0n];
      const calldatas = [calldata];
      const description = "test";

      await expect(
        dao.connect(proposer).propose(
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          OpenProposalMajority.Low,
          { value: createProposalFee },
        )
      ).to.be.revertedWithCustomError(dao, "NewValueOutOfRange").withArgs(newVal);
    });

    it("should successfully propose ecosystem parameter change increment", async function () {
      const proposer = users[2];
      const calldata = mockStaking.interface.encodeFunctionData("setDelegatorMinStake", ['150000000000000000000']);

      const targets = [await mockStaking.getAddress()];
      const values = [0n];
      const calldatas = [calldata];
      const description = "test";

      const proposalId = await dao.hashProposal(
        targets,
        values,
        calldatas,
        description
      );

      await expect(
        dao.connect(proposer).propose(
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          OpenProposalMajority.Low,
          { value: createProposalFee }
        )
      ).to.emit(dao, "ProposalCreated")
        .withArgs(
          proposer.address,
          proposalId,
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          createProposalFee
        );
    });

    it("should successfully propose ecosystem parameter change decrement and confirm proposalType", async function () {
      const proposer = users[2];
      const calldata = mockStaking.interface.encodeFunctionData("setDelegatorMinStake", ['50000000000000000000']);

      const targets = [await mockStaking.getAddress()];
      const values = [0n];
      const calldatas = [calldata];
      const description = "test";

      const proposalId = await dao.hashProposal(
        targets,
        values,
        calldatas,
        description
      );

      await expect(
        dao.connect(proposer).propose(
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          OpenProposalMajority.Low,
          { value: createProposalFee })
      ).to.emit(dao, "ProposalCreated")
        .withArgs(
          proposer.address,
          proposalId,
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          createProposalFee
        );

      expect((await dao.getProposal(proposalId)).proposalType).to.equal(2);
    });

    it("should successfully propose contract upgrade and confirm proposalType", async function () {
      const proposer = users[2];
      const calldata = mockValidatorSet.interface.encodeFunctionData("validatorAvailableSince", [await mockValidatorSet.getAddress()]);

      const targets = [await mockValidatorSet.getAddress()];
      const values = [0n];
      const calldatas = [calldata];
      const description = "test";

      const proposalId = await dao.hashProposal(
        targets,
        values,
        calldatas,
        description
      );

      await expect(
        dao.connect(proposer).propose(
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          OpenProposalMajority.Low,
          { value: createProposalFee })
      ).to.emit(dao, "ProposalCreated")
        .withArgs(
          proposer.address,
          proposalId,
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          createProposalFee
        );

      expect((await dao.getProposal(proposalId)).proposalType).to.equal(1);
    });

    it("should propose a ecosystem parameter change and execute it", async function () {
      const proposer = users[2];
      const calldata = mockStaking.interface.encodeFunctionData("setDelegatorMinStake", ['50000000000000000000']);

      const targets = [await mockStaking.getAddress()];
      const values = [0n];
      const calldatas = [calldata];

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        targets,
        values,
        calldatas
      );

      await expect(dao.connect(proposer).execute(proposalId))
        .to.emit(dao, "ProposalExecuted")
        .withArgs(proposer.address, proposalId);

      expect(await mockStaking.delegatorMinStake()).to.equal('50000000000000000000');
    });
  });
});