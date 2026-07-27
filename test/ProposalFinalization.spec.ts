import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { encodeFunctionData, getAddress, parseEther } from "viem";

import { deployProxy } from "./fixtures/proxy.js";
import { createRandomWallet } from "./fixtures/wallet.js";

import {
  createProposal,
  OpenProposalMajority,
  ProposalState,
  Vote,
} from "./fixtures/proposal.js";

import { DiamondDao, MockStakingHbbft, MockValidatorSetHbbft } from "./fixtures/types.js";
import { EmptyBytes } from "./fixtures/utils.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

describe("Proposal Acceptance Threshold", function () {
  let users: TestWalletClient[];
  let owner: TestWalletClient;
  let reinsertPot: TestWalletClient;

  const createProposalFee = parseEther("10");
  const governancePotValue = parseEther("500");

  before(async () => {
    const signers = await hhViem.getWalletClients();

    owner = signers[0];
    reinsertPot = signers[1];
    users = signers.slice(2);
  });

  async function deployFixture() {
    const mockValidatorSet = await hhViem.deployContract("MockValidatorSetHbbft");
    const mockStaking = await hhViem.deployContract("MockStakingHbbft", [mockValidatorSet.address]);

    const mockTxPermission = createRandomWallet().address;
    const mockBonusScore = createRandomWallet().address;

    const daoLowMajority = await deployProxy(hhViem, "MockDiamondDaoLowMajority", {
      initArgs: [owner.account.address],
      initializer: "initialize",
    });

    const startTime = await helpers.time.latest();

    const dao = await deployProxy(hhViem, "DiamondDao", {
      initArgs: [
        owner.account.address,
        mockValidatorSet.address,
        mockStaking.address,
        reinsertPot.account.address,
        mockTxPermission,
        mockBonusScore,
        daoLowMajority.address,
        createProposalFee,
        startTime + 10,
      ],
      initializer: "initialize",
    });

    await owner.sendTransaction({
      value: governancePotValue,
      to: dao.address,
    });

    await daoLowMajority.write.setMainDaoAddress([dao.address]);

    return { dao, mockValidatorSet, mockStaking };
  }

  async function swithPhase(dao: DiamondDao) {
    const [, end, ,] = await dao.read.daoPhase();
    await helpers.time.increaseTo(end + 1n);

    await dao.write.switchPhase();
  }

  async function addValidatorsStake(
    validatorSet: MockValidatorSetHbbft,
    staking: MockStakingHbbft,
    validators: TestWalletClient[],
    stakeAmount?: bigint
  ) {
    const stake = stakeAmount ? stakeAmount : parseEther("10");

    for (const validator of validators) {
      await validatorSet.write.add([validator.account.address, validator.account.address, true]);
      await staking.write.setStake([validator.account.address, stake]);
    }
  }

  async function vote(
    dao: DiamondDao,
    proposalId: bigint,
    voters: TestWalletClient[],
    vote: Vote
  ) {
    for (const voter of voters) {
      await dao.write.vote([proposalId, vote], { account: voter.account });
    }
  }

  describe("Proposal acceptance threshold", async function () {
    it("should accept proposal (33% required) [TC001]", async function () {
      const voters = users.slice(10, 20);

      const { dao, mockValidatorSet, mockStaking } = await helpers.loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = parseEther("0");

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters,
        parseEther("100000")
      );

      const { proposalId } = await createProposal(
        dao,
        users[1].account,
        {
          description: "fund user 5",
          targets: [userToFund.account.address],
          values: [fundAmount],
          calldatas: [EmptyBytes],
          createProposalFee,
        }
      );

      await proposer.sendTransaction({
        to: dao.address,
        value: fundAmount,
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(0, 6), Vote.Yes); // 60%
      await vote(dao, proposalId, voters.slice(6, 7), Vote.No); // 10%
      await swithPhase(dao);

      assert.ok(await dao.write.finalize([proposalId]));

      assert.equal((await dao.read.getProposal([proposalId])).state, ProposalState.Accepted);

      await hhViem.assertions.emitWithArgs(
        dao.write.execute([proposalId], { account: proposer.account }),
        dao,
        "ProposalExecuted",
        [proposer.account.address, proposalId],
      );

      assert.equal((await dao.read.getProposal([proposalId])).state, ProposalState.Executed);
    });

    it("should not accept proposal (33% required) [TC002]", async function () {
      const voters = users.slice(10, 20);

      const { dao, mockValidatorSet, mockStaking } = await helpers.loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = parseEther("0");

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 6),
        parseEther("50000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(6, 10),
        parseEther("150000")
      );

      const { proposalId } = await createProposal(
        dao,
        users[1].account,
        {
          description: "fund user 5",
          targets: [userToFund.account.address],
          values: [fundAmount],
          calldatas: [EmptyBytes],
          createProposalFee,
        }
      );

      await proposer.sendTransaction({
        to: dao.address,
        value: fundAmount,
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(5, 8), Vote.Yes); // 35%
      await vote(dao, proposalId, voters.slice(0, 5), Vote.No); // 25%
      await swithPhase(dao);

      assert.ok(await dao.write.finalize([proposalId]));

      assert.equal((await dao.read.getProposal([proposalId])).state, ProposalState.Declined);
    });

    it("should not accept proposal (33% required) [TC003]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await helpers.loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = parseEther("0");

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        parseEther("10000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        parseEther("50000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        parseEther("150000")
      );

      const { proposalId } = await createProposal(
        dao,
        users[1].account,
        {
          description: "fund user 5",
          targets: [userToFund.account.address],
          values: [fundAmount],
          calldatas: [EmptyBytes],
          createProposalFee,
        }
      );

      await proposer.sendTransaction({
        to: dao.address,
        value: fundAmount,
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(0, 4), Vote.Yes); // 4%
      await vote(dao, proposalId, voters.slice(5, 6), Vote.Yes); // 5%
      await vote(dao, proposalId, voters.slice(4, 5), Vote.No); // 1 %
      await swithPhase(dao);

      assert.ok(await dao.write.finalize([proposalId]));

      assert.equal((await dao.read.getProposal([proposalId])).state, ProposalState.Declined);
    });

    it("should not accept proposal (33% required) [TC004]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await helpers.loadFixture(deployFixture);

      const proposer = users[4];
      const userToFund = users[5];
      const fundAmount = parseEther("0");

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        parseEther("10000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        parseEther("50000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        parseEther("150000")
      );

      const { proposalId } = await createProposal(
        dao,
        users[1].account,
        {
          description: "fund user 5",
          targets: [userToFund.account.address],
          values: [fundAmount],
          calldatas: [EmptyBytes],
          createProposalFee,
        }
      );

      await proposer.sendTransaction({
        to: dao.address,
        value: fundAmount,
      });

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(9, 11), Vote.Yes); // 30%
      await vote(dao, proposalId, voters.slice(0, 3), Vote.Yes); // 3%
      await vote(dao, proposalId, voters.slice(3, 4), Vote.No); // 1%
      await swithPhase(dao);

      assert.ok(await dao.write.finalize([proposalId]));

      assert.equal((await dao.read.getProposal([proposalId])).state, ProposalState.Declined);
    });

    it("should accept proposal (50% required) [TC005]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await helpers.loadFixture(deployFixture);

      const proposer = users[4];

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        parseEther("10000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        parseEther("50000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        parseEther("150000")
      );

      const calldata = encodeFunctionData({
        abi: mockStaking.abi,
        functionName: "setDelegatorMinStake",
        args: [50000000000000000000n],
      });

      const targets = [getAddress(mockStaking.address)];
      const values = [0n];
      const calldatas = [calldata];
      const description = "test";

      const proposalId = await dao.read.hashProposal([
        targets,
        values,
        calldatas,
        description,
      ]);

      await hhViem.assertions.emitWithArgs(
        dao.write.propose(
          [
            targets,
            values,
            calldatas,
            "title",
            description,
            "url",
            OpenProposalMajority.Low,
          ],
          { value: createProposalFee, account: proposer.account },
        ),
        dao,
        "ProposalCreated",
        [
          getAddress(proposer.account.address),
          proposalId,
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          createProposalFee,
        ],
      );

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(9, 13), Vote.Yes); // 60%
      await vote(dao, proposalId, voters.slice(5, 7), Vote.Yes); // 10%
      await vote(dao, proposalId, voters.slice(13, 14), Vote.No); // 15 %
      await vote(dao, proposalId, voters.slice(0, 3), Vote.No); // 3 %
      await swithPhase(dao);

      assert.ok(await dao.write.finalize([proposalId]));

      assert.equal((await dao.read.getProposal([proposalId])).state, ProposalState.Accepted);
    });

    it("should not accept proposal (50% required) [TC006]", async function () {
      const voters = users.slice(6, 20);

      const { dao, mockValidatorSet, mockStaking } = await helpers.loadFixture(deployFixture);

      const proposer = users[4];

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(0, 5),
        parseEther("10000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(5, 9),
        parseEther("50000")
      );

      await addValidatorsStake(
        mockValidatorSet,
        mockStaking,
        voters.slice(9, 14),
        parseEther("150000")
      );

      const calldata = encodeFunctionData({
        abi: mockStaking.abi,
        functionName: "setDelegatorMinStake",
        args: [50000000000000000000n],
      });

      const targets = [getAddress(mockStaking.address)];
      const values = [0n];
      const calldatas = [calldata];
      const description = "test";

      const proposalId = await dao.read.hashProposal([
        targets,
        values,
        calldatas,
        description,
      ]);

      await hhViem.assertions.emitWithArgs(
        dao.write.propose(
          [
            targets,
            values,
            calldatas,
            "title",
            description,
            "url",
            OpenProposalMajority.Low,
          ],
          { value: createProposalFee, account: proposer.account },
        ),
        dao,
        "ProposalCreated",
        [
          getAddress(proposer.account.address),
          proposalId,
          targets,
          values,
          calldatas,
          "title",
          description,
          "url",
          createProposalFee,
        ],
      );

      await swithPhase(dao);
      await vote(dao, proposalId, voters.slice(9, 13), Vote.Yes); // 60%
      await vote(dao, proposalId, voters.slice(5, 6), Vote.Yes); // 5%
      await vote(dao, proposalId, voters.slice(0, 2), Vote.Yes); // 2%
      await vote(dao, proposalId, voters.slice(13, 14), Vote.No); // 15%
      await vote(dao, proposalId, voters.slice(6, 7), Vote.No); // 5%
      await vote(dao, proposalId, voters.slice(2, 3), Vote.No); // 1%
      await swithPhase(dao);

      assert.ok(await dao.write.finalize([proposalId]));

      assert.equal((await dao.read.getProposal([proposalId])).state, ProposalState.Declined);
    });
  });
});
