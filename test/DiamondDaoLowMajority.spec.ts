import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";

import { encodeFunctionData, getAddress, parseEther, zeroAddress } from "viem";

import { deployProxy } from "./fixtures/proxy.js";
import { EmptyBytes, getRandomBigInt } from "./fixtures/utils.js";

const connection = await hre.network.getOrCreate();
const { viem: hhViem, networkHelpers: helpers } = connection;

type TestWalletClient = Awaited<ReturnType<typeof hhViem.getWalletClients>>[number];

describe("DiamondDaoLowMajority Contract", function () {
  let users: TestWalletClient[];
  let mainDao: TestWalletClient;

  before(async () => {
    const signers = await hhViem.getWalletClients();
    mainDao = signers[0];
    users = signers.slice(1);
  });

  async function deployFixture() {
    const mockReceiver = await hhViem.deployContract("MockEtherReceiver");
    const mockERC20 = await hhViem.deployContract("MockERC20");
    const mockERC721 = await hhViem.deployContract("MockERC721");
    const mockERC1155 = await hhViem.deployContract("MockERC1155");

    const lowMajorityDao = await deployProxy(hhViem, "DiamondDaoLowMajority", {
      initArgs: [mainDao.account.address],
      initializer: "initialize",
    });

    const reentrancyAttacker = await hhViem.deployContract("ReentrancyAttackerLowMajority");

    const initBalance = parseEther("10000");
    await helpers.setBalance(mainDao.account.address, initBalance * 2n);

    await mainDao.sendTransaction({
      to: lowMajorityDao.address,
      value: initBalance,
    });

    return { lowMajorityDao, mockReceiver, reentrancyAttacker, mockERC20, mockERC721, mockERC1155 };
  }

  describe("initialize", function () {
    it("should set the correct mainDao address", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);

      assert.equal(
        getAddress(await lowMajorityDao.read.mainDao()),
        getAddress(mainDao.account.address),
      );
    });

    it("should revert if initialized with zero address", async function () {
      const implementation = await hhViem.deployContract("DiamondDaoLowMajority");

      await hhViem.assertions.revertWithCustomError(
        deployProxy(hhViem, "DiamondDaoLowMajority", {
          initArgs: [zeroAddress],
          initializer: "initialize",
        }),
        implementation,
        "InvalidArgument",
      );
    });

    it("should not allow reinitialization", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);
      const implementation = await hhViem.deployContract("DiamondDaoLowMajority");

      await hhViem.assertions.revertWithCustomError(
        lowMajorityDao.write.initialize([mainDao.account.address]),
        implementation,
        "InvalidInitialization",
      );
    });
  });

  describe("lowMajorityDaoPot", function () {
    it("should increase lowMajorityPot when receiving funds", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);

      const sendAmount = parseEther("1");
      const sender = users[0];

      const potSizeBefore = await lowMajorityDao.read.lowMajorityPot();

      await hhViem.assertions.balancesHaveChanged(
        sender.sendTransaction({
          to: lowMajorityDao.address,
          value: sendAmount,
        }),
        [
          {
            address: lowMajorityDao.address,
            amount: sendAmount,
          },
        ],
      );

      assert.equal(await lowMajorityDao.read.lowMajorityPot(), potSizeBefore + sendAmount);
    });
  });

  describe("execute", function () {
    it("should restrict calling only to main DAO contract", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);

      const caller = users[0];

      await hhViem.assertions.revertWithCustomError(
        lowMajorityDao.write.execute(
          [getRandomBigInt(), [], [], []],
          { account: caller.account },
        ),
        lowMajorityDao,
        "OnlyGovernance",
      );
    });

    it("should execute a proposal with one target", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const target = users[1];
      const msgValue = parseEther("10");

      const potSizeBefore = await lowMajorityDao.read.lowMajorityPot();

      const tx = lowMajorityDao.write.execute(
        [proposalId, [target.account.address], [msgValue], [EmptyBytes]],
        { account: mainDao.account },
      );

      await hhViem.assertions.emitWithArgs(
        tx,
        lowMajorityDao,
        "LowMajorityProposalExecuted",
        [proposalId],
      );

      await hhViem.assertions.balancesHaveChanged(
        tx,
        [
          {
            address: lowMajorityDao.address,
            amount: -msgValue,
          },
          {
            address: target.account.address,
            amount: msgValue,
          },
        ],
      );

      assert.equal(await lowMajorityDao.read.lowMajorityPot(), potSizeBefore - msgValue);
    });

    it("should execute a proposal with multiple targets", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);

      const alice = users[1];
      const bob = users[2];

      const aliceAmount = parseEther("5");
      const bobAmount = parseEther("10");

      const proposalId = getRandomBigInt();

      const tx = lowMajorityDao.write.execute(
        [
          proposalId,
          [alice.account.address, bob.account.address],
          [aliceAmount, bobAmount],
          [EmptyBytes, EmptyBytes],
        ],
        { account: mainDao.account },
      );

      await hhViem.assertions.emitWithArgs(
        tx,
        lowMajorityDao,
        "LowMajorityProposalExecuted",
        [proposalId],
      );

      await hhViem.assertions.balancesHaveChanged(
        tx,
        [
          {
            address: lowMajorityDao.address,
            amount: -(aliceAmount + bobAmount),
          },
          {
            address: alice.account.address,
            amount: aliceAmount,
          },
          {
            address: bob.account.address,
            amount: bobAmount,
          },
        ],
      );
    });

    it("should execute contract calls with specific function data", async function () {
      const { lowMajorityDao, mockReceiver } = await helpers.loadFixture(deployFixture);

      const calldata = encodeFunctionData({
        abi: mockReceiver.abi,
        functionName: "toggleReceive",
        args: [false],
      });

      assert.equal(await mockReceiver.read.allowReceive(), true);

      await lowMajorityDao.write.execute(
        [getRandomBigInt(), [mockReceiver.address], [0n], [calldata]],
        { account: mainDao.account },
      );

      assert.equal(await mockReceiver.read.allowReceive(), false);
    });

    it("should revert if a target call fails", async function () {
      const { lowMajorityDao, mockReceiver } = await helpers.loadFixture(deployFixture);

      const sendAmount = parseEther("5");
      await mockReceiver.write.toggleReceive([false]);

      await hhViem.assertions.revertWithCustomError(
        lowMajorityDao.write.execute(
          [getRandomBigInt(), [mockReceiver.address], [sendAmount], [EmptyBytes]],
          { account: mainDao.account },
        ),
        mockReceiver,
        "ReceiveDisabled",
      );
    });

    it("should be non reentrant", async function () {
      const { lowMajorityDao, reentrancyAttacker } = await helpers.loadFixture(deployFixture);

      const sendAmount = parseEther("1");

      await hhViem.assertions.revertWithCustomError(
        lowMajorityDao.write.execute(
          [getRandomBigInt(), [reentrancyAttacker.address], [sendAmount], [EmptyBytes]],
          { account: mainDao.account },
        ),
        lowMajorityDao,
        "ReentrancyGuardReentrantCall",
      );
    });

    it("should transfer ERC20 tokens", async function () {
      const { lowMajorityDao, mockERC20 } = await helpers.loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const user = users[1];
      const tokensAmount = parseEther("10");
      const calldata = encodeFunctionData({
        abi: mockERC20.abi,
        functionName: "transfer",
        args: [user.account.address, tokensAmount],
      });

      await mockERC20.write.mint([lowMajorityDao.address, tokensAmount]);

      await hhViem.assertions.emitWithArgs(
        lowMajorityDao.write.execute(
          [proposalId, [mockERC20.address], [0n], [calldata]],
          { account: mainDao.account },
        ),
        lowMajorityDao,
        "LowMajorityProposalExecuted",
        [proposalId],
      );

      assert.equal(await mockERC20.read.balanceOf([lowMajorityDao.address]), 0n);
      assert.equal(await mockERC20.read.balanceOf([user.account.address]), tokensAmount);
    });

    it("should transfer ERC721 token", async function () {
      const { lowMajorityDao, mockERC721 } = await helpers.loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const user = users[1];
      const tokenId = getRandomBigInt();
      const daoAddress = lowMajorityDao.address;

      const calldata = encodeFunctionData({
        abi: mockERC721.abi,
        functionName: "transferFrom",
        args: [daoAddress, user.account.address, tokenId],
      });

      await mockERC721.write.mint([daoAddress, tokenId]);
      assert.equal(getAddress(await mockERC721.read.ownerOf([tokenId])), getAddress(daoAddress));

      await hhViem.assertions.emitWithArgs(
        lowMajorityDao.write.execute(
          [proposalId, [mockERC721.address], [0n], [calldata]],
          { account: mainDao.account },
        ),
        lowMajorityDao,
        "LowMajorityProposalExecuted",
        [proposalId],
      );

      assert.equal(
        getAddress(await mockERC721.read.ownerOf([tokenId])),
        getAddress(user.account.address),
      );
    });

    it("should transfer ERC1155 token", async function () {
      const { lowMajorityDao, mockERC1155 } = await helpers.loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const user = users[1];
      const tokenId = getRandomBigInt();
      const tokensAmount = 1000n;
      const daoAddress = lowMajorityDao.address;

      const calldata = encodeFunctionData({
        abi: mockERC1155.abi,
        functionName: "safeTransferFrom",
        args: [daoAddress, user.account.address, tokenId, tokensAmount, EmptyBytes],
      });

      await mockERC1155.write.mint([daoAddress, tokenId, tokensAmount]);
      assert.equal(await mockERC1155.read.balanceOf([daoAddress, tokenId]), tokensAmount);

      await hhViem.assertions.emitWithArgs(
        lowMajorityDao.write.execute(
          [proposalId, [mockERC1155.address], [0n], [calldata]],
          { account: mainDao.account },
        ),
        lowMajorityDao,
        "LowMajorityProposalExecuted",
        [proposalId],
      );

      assert.equal(await mockERC1155.read.balanceOf([daoAddress, tokenId]), 0n);
      assert.equal(await mockERC1155.read.balanceOf([user.account.address, tokenId]), tokensAmount);
    });
  });

  describe("quorumReached", function () {
    it("should correctly determine if low majority quorum is reached", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);

      const votingResult = {
        countYes: 100n,
        countNo: 50n,
        stakeYes: parseEther("1000"),
        stakeNo: parseEther("500"),
      };

      const totalStakedAmount = votingResult.stakeYes + votingResult.stakeNo;

      assert.equal(
        await lowMajorityDao.read.quorumReached([votingResult, totalStakedAmount]),
        true,
      );
    });

    it("should correctly determine if low majority quorum is not reached", async function () {
      const { lowMajorityDao } = await helpers.loadFixture(deployFixture);

      const votingResult = {
        countYes: 10n,
        countNo: 90n,
        stakeYes: parseEther("100"),
        stakeNo: parseEther("1900"),
      };

      const totalStakedAmount = votingResult.stakeYes + votingResult.stakeNo;

      assert.equal(
        await lowMajorityDao.read.quorumReached([votingResult, totalStakedAmount]),
        false,
      );
    });
  });
});
