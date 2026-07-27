import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { type Address, encodeFunctionData, getAddress, type Hex, parseEther } from "viem";

import { deployProxy } from "./fixtures/proxy.js";
import { createRandomWallet } from "./fixtures/wallet.js";

import {
  createProposal,
  OpenProposalMajority,
  ProposalType,
  Vote,
} from "./fixtures/proposal.js";

import { DiamondDao, MockStakingHbbft, MockValidatorSetHbbft } from "./fixtures/types.js";
import { getRandomBigInt } from "./fixtures/utils.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

describe("DAO Ecosystem Paramater Change Value Guards Test", function () {
  let users: TestWalletClient[];
  let owner: TestWalletClient;
  let reinsertPot: TestWalletClient;

  let dao: DiamondDao;
  let mockValidatorSet: MockValidatorSetHbbft;
  let mockStaking: MockStakingHbbft;

  const createProposalFee = parseEther("10");
  const governancePotValue = parseEther("500");

  before(async () => {
    const signers = await hhViem.getWalletClients();

    owner = signers[0];
    reinsertPot = signers[1];
    users = signers.slice(2);

    ({ dao, mockValidatorSet, mockStaking } = await helpers.loadFixture(deployFixture));
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

    await daoLowMajority.write.setMainDaoAddress([dao.address]);

    await helpers.setBalance(owner.account.address, governancePotValue * 10n);

    await owner.sendTransaction({
      value: governancePotValue,
      to: dao.address,
    });

    await owner.sendTransaction({
      value: governancePotValue,
      to: daoLowMajority.address,
    });

    return { dao, daoLowMajority, mockValidatorSet, mockStaking };
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

  async function finalizedProposal(
    dao: DiamondDao,
    mockValidatorSet: MockValidatorSetHbbft,
    mockStaking: MockStakingHbbft,
    _vote: Vote,
    targets?: Address[],
    values?: bigint[],
    calldatas?: Hex[]
  ) {
    const proposer = users[2];
    const voters = users.slice(10, 25);

    const { proposalId } = await createProposal(
      dao,
      proposer.account,
      {
        description: getRandomBigInt().toString(),
        targets,
        values,
        calldatas,
        createProposalFee,
      }
    );

    await swithPhase(dao);
    await addValidatorsStake(mockValidatorSet, mockStaking, voters);
    await vote(dao, proposalId, voters, _vote);

    await swithPhase(dao);

    await dao.write.finalize([proposalId]);

    return { proposalId, proposer };
  }

  describe("proposal Value Guards", async function () {
    it("should set staking contract as isCoreContract", async function () {
      const proposer = users[2];
      const calldata = encodeFunctionData({
        abi: dao.abi,
        functionName: "setIsCoreContract",
        args: [mockStaking.address, true],
      });

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [dao.address],
        [0n],
        [calldata]
      );

      await hhViem.assertions.emitWithArgs(
        dao.write.execute([proposalId], { account: proposer.account }),
        dao,
        "SetIsCoreContract",
        [getAddress(mockStaking.address), true],
      );
    });

    it("should fail to propose as ecosystem parameter change", async function () {
      const newVal = 50000000000000000000n;
      const calldata = encodeFunctionData({
        abi: mockStaking.abi,
        functionName: "setDelegatorMinStake",
        args: [newVal],
      });

      const targets = [mockStaking.address];
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

      assert.equal(
        (await dao.read.getProposal([proposalId])).proposalType,
        ProposalType.ContractUpgrade,
      );
    });

    it("should set setChangeAbleParameters", async function () {
      const setter = "setDelegatorMinStake(uint256)";
      const getter = "delegatorMinStake()";
      const params = [
        50000000000000000000n,
        100000000000000000000n,
        150000000000000000000n,
        200000000000000000000n,
        250000000000000000000n,
      ];

      await hhViem.assertions.emitWithArgs(
        mockStaking.write.setAllowedChangeableParameter([setter, getter, params]),
        mockStaking,
        "SetChangeAbleParameter",
        [setter, getter, params],
      );
    });

    it("should fail to propose ecosystem parameter change as invalid upgrade value", async function () {
      const proposer = users[2];
      const newVal = 200000000000000000000n;
      const calldata = encodeFunctionData({
        abi: mockStaking.abi,
        functionName: "setDelegatorMinStake",
        args: [newVal],
      });

      const targets = [mockStaking.address];
      const values = [0n];
      const calldatas = [calldata];
      const description = "test";

      await hhViem.assertions.revertWithCustomErrorWithArgs(
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
        "NewValueOutOfRange",
        [newVal],
      );
    });

    it("should successfully propose ecosystem parameter change increment", async function () {
      const proposer = users[2];
      const calldata = encodeFunctionData({
        abi: mockStaking.abi,
        functionName: "setDelegatorMinStake",
        args: [150000000000000000000n],
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
    });

    it("should successfully propose ecosystem parameter change decrement and confirm proposalType", async function () {
      const proposer = users[2];
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

      assert.equal(
        (await dao.read.getProposal([proposalId])).proposalType,
        ProposalType.EcosystemParameterChange,
      );
    });

    it("should successfully propose contract upgrade and confirm proposalType", async function () {
      const proposer = users[2];
      const calldata = encodeFunctionData({
        abi: mockValidatorSet.abi,
        functionName: "validatorAvailableSince",
        args: [mockValidatorSet.address],
      });

      const targets = [getAddress(mockValidatorSet.address)];
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

      assert.equal(
        (await dao.read.getProposal([proposalId])).proposalType,
        ProposalType.ContractUpgrade,
      );
    });

    it("should propose a ecosystem parameter change and execute it", async function () {
      const proposer = users[2];
      const calldata = encodeFunctionData({
        abi: mockStaking.abi,
        functionName: "setDelegatorMinStake",
        args: [50000000000000000000n],
      });

      const targets = [mockStaking.address];
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

      await hhViem.assertions.emitWithArgs(
        dao.write.execute([proposalId], { account: proposer.account }),
        dao,
        "ProposalExecuted",
        [proposer.account.address, proposalId],
      );

      assert.equal(await mockStaking.read.delegatorMinStake(), 50000000000000000000n);
    });
  });
});
