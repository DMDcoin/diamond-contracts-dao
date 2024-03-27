import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

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
  

describe("DAO Ecosystem Paramater Change Value Guards Test", function () {
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

    const mockStaking = await stakingFactory.deploy();
    await mockStaking.waitForDeployment();

    const startTime = await time.latest();

    const daoProxy = await upgrades.deployProxy(daoFactory, [
      await mockValidatorSet.getAddress(),
      await mockStaking.getAddress(),
      reinsertPot.address,
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
      _description,
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
    it("should set staking contract as isCoreContract", async function () {
        const funcFragment = dao.interface.getFunction("setIsCoreContract");
        const calldata = dao.interface.encodeFunctionData(funcFragment, [await mockStaking.getAddress(), true]);
  
        const { proposalId } = await finalizedProposal(
          dao,
          mockValidatorSet,
          mockStaking,
          Vote.Yes,
          [await dao.getAddress()],
          [0n],
          [calldata]
        );
  
        await expect(dao.execute(proposalId)).to.emit(dao, "SetIsCoreContract").withArgs(await mockStaking.getAddress(), true);
    });

    it("should fail to propose ecosystem parameter change as not allowed", async function () {
        const proposer = users[2];
        const funcFragment = mockStaking.interface.getFunction("setDelegatorMinStake");
        const calldata = mockStaking.interface.encodeFunctionData(funcFragment, ['50000000000000000000']);
  
        const targets = [await mockStaking.getAddress()];
        const values = [0n];
        const calldatas = [calldata];
        const description = "test";
  
        await expect(
          dao.connect(proposer).propose(targets, values, calldatas, description, { value: createProposalFee })
        ).to.be.revertedWithCustomError(dao, "FunctionUpgradeNotAllowed");
    });

    it("should set setChangeAbleParameters", async function () {
      const funcFragment = dao.interface.getFunction("setChangeAbleParameters");
      const calldata = dao.interface.encodeFunctionData(funcFragment, [
        true,
        "setDelegatorMinStake(uint256)",
        "delegatorMinStake()",
        [
          "50000000000000000000",
          "100000000000000000000",
          "150000000000000000000",
          "200000000000000000000",
          "250000000000000000000",
        ],
      ]);

      const { proposalId } = await finalizedProposal(
        dao,
        mockValidatorSet,
        mockStaking,
        Vote.Yes,
        [await dao.getAddress()],
        [0n],
        [calldata]
      );

      await expect(dao.execute(proposalId)).to.emit(dao, "SetChangeAbleParameters").withArgs(
        true,
        "setDelegatorMinStake(uint256)",
        "delegatorMinStake()",
        [
            "50000000000000000000",
            "100000000000000000000",
            "150000000000000000000",
            "200000000000000000000",
            "250000000000000000000",
        ]
      );
    });

    it("should fail to propose ecosystem parameter change as invalid upgrade value", async function () {
        const proposer = users[2];
        const funcFragment = mockStaking.interface.getFunction("setDelegatorMinStake");
        const calldata = mockStaking.interface.encodeFunctionData(funcFragment, ['200000000000000000000']);
  
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
          dao.connect(proposer).propose(targets, values, calldatas, description, { value: createProposalFee })
        ).to.be.revertedWithCustomError(dao, "InvalidUpgradeValue");
      });

    it("should successfully propose ecosystem parameter change increment", async function () {
      const proposer = users[2];
      const funcFragment = mockStaking.interface.getFunction("setDelegatorMinStake");
      const calldata = mockStaking.interface.encodeFunctionData(funcFragment, ['150000000000000000000']);

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

    it("should successfully propose ecosystem parameter change decrement", async function () {
        const proposer = users[2];
        const funcFragment = mockStaking.interface.getFunction("setDelegatorMinStake");
        const calldata = mockStaking.interface.encodeFunctionData(funcFragment, ['50000000000000000000']);
  
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
  });

});