import { ethers, upgrades } from "hardhat";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { loadFixture, setBalance } from "@nomicfoundation/hardhat-network-helpers";

import { DiamondDaoLowMajority } from "../typechain-types";
import { EmptyBytes, getRandomBigInt } from "./fixture/utils";

describe("DiamondDaoLowMajority Contract", function () {
  let users: HardhatEthersSigner[];
  let mainDao: HardhatEthersSigner;

  before(async () => {
    const signers = await ethers.getSigners();
    mainDao = signers[0];

    users = signers.slice(1);
  });

  async function deployFixture() {
    const mockFactory = await ethers.getContractFactory("MockEtherReceiver");
    const mockReceiver = await mockFactory.deploy();
    await mockReceiver.waitForDeployment();

    const mockERC20Factory = await ethers.getContractFactory("MockERC20");
    const mockERC20 = await mockERC20Factory.deploy();
    await mockERC20.waitForDeployment();

    const mockERC721Factory = await ethers.getContractFactory("MockERC721");
    const mockERC721 = await mockERC721Factory.deploy();
    await mockERC721.waitForDeployment();

    const mockERC1155Factory = await ethers.getContractFactory("MockERC1155");
    const mockERC1155 = await mockERC1155Factory.deploy();
    await mockERC1155.waitForDeployment();

    const factory = await ethers.getContractFactory("DiamondDaoLowMajority");

    const lowMajorityDao = (await upgrades.deployProxy(factory,
      [mainDao.address],
      { initializer: "initialize" },
    )) as unknown as DiamondDaoLowMajority;

    await lowMajorityDao.waitForDeployment();

    const reentrancyAttackerFactory = await ethers.getContractFactory("ReentrancyAttackerLowMajority");
    const reentrancyAttacker = await reentrancyAttackerFactory.deploy();
    await reentrancyAttacker.waitForDeployment();

    const initBalance = ethers.parseEther("10000");
    await setBalance(mainDao.address, initBalance * 2n);

    await mainDao.sendTransaction({
      to: await lowMajorityDao.getAddress(),
      value: initBalance,
    });

    return { lowMajorityDao, mockReceiver, reentrancyAttacker, mockERC20, mockERC721, mockERC1155 };
  }

  describe("initialize", function () {
    it("should set the correct mainDao address", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      expect(await lowMajorityDao.mainDao()).to.equal(mainDao.address);
    });

    it("should revert if initialized with zero address", async function () {
      const factory = await ethers.getContractFactory("DiamondDaoLowMajority");

      await expect(
        upgrades.deployProxy(
          factory,
          [ethers.ZeroAddress],
          { initializer: "initialize" },
        )
      ).to.be.revertedWithCustomError(factory, "InvalidArgument");
    });

    it("should not allow reinitialization", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      await expect(lowMajorityDao.initialize(mainDao.address))
        .to.be.revertedWithCustomError(lowMajorityDao, "InvalidInitialization");
    });
  });

  describe("lowMajorityDaoPot", function () {
    it("should increase lowMajorityPot when receiving funds", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      const sendAmount = ethers.parseEther("1");
      const sender = users[0];

      const potSizeBefore = await lowMajorityDao.lowMajorityPot();

      await expect(sender.sendTransaction({
        to: await lowMajorityDao.getAddress(),
        value: sendAmount
      })).to.changeEtherBalance(await lowMajorityDao.getAddress(), sendAmount);

      expect(await lowMajorityDao.lowMajorityPot()).to.eq(potSizeBefore + sendAmount);
    });
  });

  describe("execute", function () {
    it("should restrict calling only to main DAO contract", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      const caller = users[0];

      await expect(lowMajorityDao.connect(caller).execute(
        getRandomBigInt(),
        [],
        [],
        []
      )).to.be.revertedWithCustomError(lowMajorityDao, "OnlyGovernance");
    });

    it("should execute a proposal with one target", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const target = users[1];
      const msgValue = ethers.parseEther("10");

      const potSizeBefore = await lowMajorityDao.lowMajorityPot();

      const tx = lowMajorityDao.connect(mainDao).execute(
        proposalId,
        [target],
        [msgValue],
        [EmptyBytes]
      );

      await expect(tx).to.emit(lowMajorityDao, "LowMajorityProposalExecuted").withArgs(proposalId);
      await expect(tx).to.changeEtherBalances(
        [await lowMajorityDao.getAddress(), target.address],
        [-msgValue, msgValue]
      );

      expect(await lowMajorityDao.lowMajorityPot()).to.eq(potSizeBefore - msgValue);
    });

    it("should execute a proposal with multiple targets", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      const alice = users[1];
      const bob = users[2];

      const aliceAmount = ethers.parseEther("5");
      const bobAmount = ethers.parseEther("10")

      const proposalId = getRandomBigInt();

      const tx = lowMajorityDao.connect(mainDao).execute(
        proposalId,
        [alice.address, bob.address],
        [aliceAmount, bobAmount],
        [EmptyBytes, EmptyBytes]
      );

      await expect(tx).to.emit(lowMajorityDao, "LowMajorityProposalExecuted").withArgs(proposalId);
      await expect(tx).to.changeEtherBalances(
        [await lowMajorityDao.getAddress(), alice.address, bob.address],
        [-(aliceAmount + bobAmount), aliceAmount, bobAmount]
      );
    });

    it("should execute contract calls with specific function data", async function () {
      const { lowMajorityDao, mockReceiver } = await loadFixture(deployFixture);

      const calldata = mockReceiver.interface.encodeFunctionData("toggleReceive", [false]);

      expect(await mockReceiver.allowReceive()).to.be.true;

      await lowMajorityDao.connect(mainDao).execute(
        getRandomBigInt(),
        [await mockReceiver.getAddress()],
        [0n],
        [calldata]
      );

      expect(await mockReceiver.allowReceive()).to.be.false;
    });

    it("should revert if a target call fails", async function () {
      const { lowMajorityDao, mockReceiver } = await loadFixture(deployFixture);

      const sendAmount = ethers.parseEther("5");
      await mockReceiver.toggleReceive(false);

      await expect(lowMajorityDao.connect(mainDao).execute(
        getRandomBigInt(),
        [await mockReceiver.getAddress()],
        [sendAmount],
        [EmptyBytes]
      )).to.be.revertedWithCustomError(mockReceiver, "ReceiveDisabled");
    });

    it("should be non reentrant", async function () {
      const { lowMajorityDao, reentrancyAttacker } = await loadFixture(deployFixture);

      const sendAmount = ethers.parseEther("1");

      await expect(lowMajorityDao.connect(mainDao).execute(
        getRandomBigInt(),
        [await reentrancyAttacker.getAddress()],
        [sendAmount],
        [EmptyBytes]
      )).to.be.revertedWithCustomError(lowMajorityDao, "ReentrancyGuardReentrantCall");
    });

    it("should transfer ERC20 tokens", async function () {
      const { lowMajorityDao, mockERC20 } = await loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const user = users[1];
      const tokensAmount = ethers.parseEther("10");
      const calldata = mockERC20.interface.encodeFunctionData("transfer", [user.address, tokensAmount])

      await mockERC20.mint(await lowMajorityDao.getAddress(), tokensAmount);


      const tx = lowMajorityDao.connect(mainDao).execute(
        proposalId,
        [await mockERC20.getAddress()],
        [0n],
        [calldata]
      );

      await expect(tx).to.emit(lowMajorityDao, "LowMajorityProposalExecuted").withArgs(proposalId);
      await expect(tx).to.changeTokenBalances(
        mockERC20,
        [await lowMajorityDao.getAddress(), user.address],
        [-tokensAmount, tokensAmount]
      );
    });

    it("should transfer ERC721 token", async function () {
      const { lowMajorityDao, mockERC721 } = await loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const user = users[1];
      const tokenId = getRandomBigInt();
      const daoAddress = await lowMajorityDao.getAddress();

      const calldata = mockERC721.interface.encodeFunctionData(
        "transferFrom",
        [daoAddress, user.address, tokenId],
      );

      await mockERC721.mint(daoAddress, tokenId);
      expect(await mockERC721.ownerOf(tokenId)).to.eq(daoAddress);

      const tx = lowMajorityDao.connect(mainDao).execute(
        proposalId,
        [await mockERC721.getAddress()],
        [0n],
        [calldata]
      );

      await expect(tx).to.emit(lowMajorityDao, "LowMajorityProposalExecuted").withArgs(proposalId);
      expect(await mockERC721.ownerOf(tokenId)).to.eq(user.address);
    });

    it("should transfer ERC1155 token", async function () {
      const { lowMajorityDao, mockERC1155 } = await loadFixture(deployFixture);

      const proposalId = getRandomBigInt();
      const user = users[1];
      const tokenId = getRandomBigInt();
      const tokensAmount = 1000;
      const daoAddress = await lowMajorityDao.getAddress();

      const calldata = mockERC1155.interface.encodeFunctionData(
        "safeTransferFrom",
        [daoAddress, user.address, tokenId, tokensAmount, EmptyBytes],
      );

      await mockERC1155.mint(daoAddress, tokenId, tokensAmount);
      expect(await mockERC1155.balanceOf(daoAddress, tokenId)).to.eq(tokensAmount);

      const tx = lowMajorityDao.connect(mainDao).execute(
        proposalId,
        [await mockERC1155.getAddress()],
        [0n],
        [calldata]
      );

      await expect(tx).to.emit(lowMajorityDao, "LowMajorityProposalExecuted").withArgs(proposalId);
      expect(await mockERC1155.balanceOf(daoAddress, tokenId)).to.eq(0);
      expect(await mockERC1155.balanceOf(user.address, tokenId)).to.eq(tokensAmount);
    });
  });

  describe("quorumReached", function () {
    it("should correctly determine if low majority quorum is reached", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      const votingResult = {
        countYes: 100,
        countNo: 50,
        stakeYes: ethers.parseEther("1000"),
        stakeNo: ethers.parseEther("500")
      };

      const totalStakedAmount = votingResult.stakeYes + votingResult.stakeNo;

      expect(await lowMajorityDao.quorumReached(votingResult, totalStakedAmount)).to.be.true;
    });

    it("should correctly determine if low majority quorum is not reached", async function () {
      const { lowMajorityDao } = await loadFixture(deployFixture);

      const votingResult = {
        countYes: 10,
        countNo: 90,
        stakeYes: ethers.parseEther("100"),
        stakeNo: ethers.parseEther("1900")
      };

      const totalStakedAmount = votingResult.stakeYes + votingResult.stakeNo;

      expect(await lowMajorityDao.quorumReached(votingResult, totalStakedAmount)).to.be.false;
    });
  });
});