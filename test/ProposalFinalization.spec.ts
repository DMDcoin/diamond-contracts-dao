import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

import { DiamondDao, MockStakingHbbft, MockValidatorSetHbbft } from "../typechain-types";

const EmptyBytes = ethers.hexlify(new Uint8Array());

enum Vote {
  No,
  Yes
}

enum ProposalState {
  Created,
  Canceled,
  Active,
  VotingFinished,
  Accepted,
  Declined,
  Executed
}

export function getRandomBigInt(): bigint {
  let hex = "0x" + Buffer.from(ethers.randomBytes(16)).toString("hex");

  return BigInt(hex);
}

describe("Proposal Acceptance Threshold", function () {
  let users: HardhatEthersSigner[];
  let reinsertPot: HardhatEthersSigner;

  let dao: any;
  let mockValidatorSet: any;
  let mockStaking: any;

  const createProposalFee = ethers.parseEther("10");
  const governancePotValue = ethers.parseEther('500');

  before(async () => {
    users = await ethers.getSigners();

    reinsertPot = users[1];

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

  describe("Proposal acceptance threshold", async function () {
    it("should accept proposal (33% required) [TC001]", async function () {
      const voters = users.slice(10, 20);

      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = ethers.parseEther('0');

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters,
        ethers.parseEther('100000')
      );

      const { proposalId } = await createProposal(
        dao,
        users[1],
        "fund user 5",
        [userToFund.address],
        [fundAmount],
        [EmptyBytes]
      );

      await proposer.sendTransaction({
        to: await dao.getAddress(),
        value: fundAmount
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(0, 6), Vote.Yes); // 60%
      await vote(dao, proposalId, voters.slice(6, 7), Vote.No); // 10%
      await swithPhase(dao);

      expect(await dao.finalize(proposalId));

      expect((await dao.getProposal(proposalId)).state).to.equal(ProposalState.Accepted);

      const tx = dao.connect(proposer).execute(proposalId);

      await expect(tx)
        .to.emit(dao, "ProposalExecuted")
        .withArgs(proposer.address, proposalId)

      expect((await dao.getProposal(proposalId)).state).to.equal(ProposalState.Executed);
    });

    it("should not accept proposal (33% required) [TC002]", async function () {
      const voters = users.slice(10, 20);

      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = ethers.parseEther('0');

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 6),
        ethers.parseEther('50000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(6, 10),
        ethers.parseEther('150000')
      );

      const { proposalId } = await createProposal(
        dao,
        users[1],
        "fund user 5",
        [userToFund.address],
        [fundAmount],
        [EmptyBytes]
      );

      await proposer.sendTransaction({
        to: await dao.getAddress(),
        value: fundAmount
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(5, 8), Vote.Yes); // 35%
      await vote(dao, proposalId, voters.slice(0, 5), Vote.No); // 25%
      await swithPhase(dao);

      expect(await dao.finalize(proposalId));

      expect((await dao.getProposal(proposalId)).state).to.equal(ProposalState.Declined);
    });

    it("should not accept proposal (33% required) [TC003]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = ethers.parseEther('0');

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        ethers.parseEther('10000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        ethers.parseEther('50000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        ethers.parseEther('150000')
      );

      const { proposalId } = await createProposal(
        dao,
        users[1],
        "fund user 5",
        [userToFund.address],
        [fundAmount],
        [EmptyBytes]
      );

      await proposer.sendTransaction({
        to: await dao.getAddress(),
        value: fundAmount
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(0, 4), Vote.Yes); // 4%
      await vote(dao, proposalId, voters.slice(5, 6), Vote.Yes); // 5%
      await vote(dao, proposalId, voters.slice(4, 5), Vote.No); // 1 %
      await swithPhase(dao);

      expect(await dao.finalize(proposalId));

      expect((await dao.getProposal(proposalId)).state).to.equal(ProposalState.Declined);
    });

    it("should not accept proposal (33% required) [TC004]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = ethers.parseEther('0');

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        ethers.parseEther('10000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        ethers.parseEther('50000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        ethers.parseEther('150000')
      );

      const { proposalId } = await createProposal(
        dao,
        users[1],
        "fund user 5",
        [userToFund.address],
        [fundAmount],
        [EmptyBytes]
      );

      await proposer.sendTransaction({
        to: await dao.getAddress(),
        value: fundAmount
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(9, 11), Vote.Yes); // 30%
      await vote(dao, proposalId, voters.slice(0, 3), Vote.Yes); // 3%
      await vote(dao, proposalId, voters.slice(3, 4), Vote.No); // 1%
      await swithPhase(dao);

      expect(await dao.finalize(proposalId));

      expect((await dao.getProposal(proposalId)).state).to.equal(ProposalState.Declined);
    });

    it("should accept proposal (50% required) [TC005]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const proposer = users[4];

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        ethers.parseEther('10000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        ethers.parseEther('50000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        ethers.parseEther('150000')
      );

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
        dao.connect(proposer).propose(targets, values, calldatas, "title", description, "url", { value: createProposalFee })
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

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(9, 13), Vote.Yes); // 60%
      await vote(dao, proposalId, voters.slice(5, 7), Vote.Yes); // 10%
      await vote(dao, proposalId, voters.slice(13, 14), Vote.No); // 15 %
      await vote(dao, proposalId, voters.slice(0, 3), Vote.No); // 3 %
      await swithPhase(dao);

      expect(await dao.finalize(proposalId));

      expect((await dao.getProposal(proposalId)).state).to.equal(ProposalState.Accepted);
    });

    it("should not accept proposal (50% required) [TC006]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await loadFixture(deployFixture);

      const proposer = users[4];
      
      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        ethers.parseEther('10000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        ethers.parseEther('50000')
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        ethers.parseEther('150000')
      );

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
        dao.connect(proposer).propose(targets, values, calldatas, "title", description, "url", { value: createProposalFee })
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

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(9, 13), Vote.Yes); // 60%
      await vote(dao, proposalId, voters.slice(5, 6), Vote.Yes); // 5%
      await vote(dao, proposalId, voters.slice(0, 2), Vote.Yes); // 2%
      await vote(dao, proposalId, voters.slice(13, 14), Vote.No); // 15%
      await vote(dao, proposalId, voters.slice(6, 7), Vote.No); // 5%
      await vote(dao, proposalId, voters.slice(2, 3), Vote.No); // 1%
      await swithPhase(dao);

      expect(await dao.finalize(proposalId));

      expect((await dao.getProposal(proposalId)).state).to.equal(ProposalState.Declined);
    });
  });
});