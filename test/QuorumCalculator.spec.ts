import { expect } from "chai";
import { ethers } from "hardhat";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("QuorumCalculator library", function () {
  async function deployContracts() {
    const factory = await ethers.getContractFactory("MockQuorumCalculator");
    const quorumCalculator = (await factory.deploy());

    return { quorumCalculator };
  }

  describe("lowMajorityQuorum", function () {
    const TestCases = [
      {
        name: "all votes are Yes",
        stakeYes: ethers.parseEther("1000"),
        stakeNo: 0n,
        expectedResult: true,
      },
      {
        name: "Yes votes exceed No votes by at least 1/3 of total",
        stakeYes: ethers.parseEther("700"),
        stakeNo: ethers.parseEther("300"),
        expectedResult: true,
      },
      {
        name: "Yes votes exactly meet the required threshold (1/3 of total)",
        stakeYes: ethers.parseEther("666"),
        stakeNo: ethers.parseEther("333"),
        expectedResult: true,
      },
      {
        name: "all votes are No",
        stakeYes: 0n,
        stakeNo: ethers.parseEther("1000"),
        expectedResult: false,
      },
      {
        name: "Yes votes don't exceed No votes by required threshold",
        stakeYes: ethers.parseEther("600"),
        stakeNo: ethers.parseEther("400"),
        expectedResult: false,
      },
      {
        // Required exceeding = 1000 * 2 = 2000
        // Yes * 6 = 666 * 6 = 3996
        // No * 6 + required = 334 * 6 + 2000 = 4004
        // 3996 < 4004
        name: "Yes votes exceed No in 1/3 corner case",
        stakeYes: ethers.parseEther("666"),
        stakeNo: ethers.parseEther("334"),
        expectedResult: false,
      },
    ];

    TestCases.forEach((args) => {
      it(`should return ${args.expectedResult} when ${args.name}`, async function () {
        const { quorumCalculator } = await helpers.loadFixture(deployContracts);

        const votingResult = {
          countYes: args.stakeYes / ethers.parseEther("1"),
          countNo: args.stakeNo / ethers.parseEther("1"),
          stakeYes: args.stakeYes,
          stakeNo: args.stakeNo
        };

        const totalStakedAmount = args.stakeYes + args.stakeNo;

        const result = await quorumCalculator.lowMajorityQuorum(votingResult, totalStakedAmount);

        expect(result).to.eq(args.expectedResult);
      });
    });
  });

  describe("highMajorityQuorum", function () {
    const TestCases = [
      {
        name: "all votes are Yes",
        stakeYes: ethers.parseEther("1000"),
        stakeNo: 0n,
        expectedResult: true,
      },
      {
        name: "Yes votes exceed No votes by at least 1/2 of total",
        stakeYes: ethers.parseEther("800"),
        stakeNo: ethers.parseEther("200"),
        expectedResult: true,
      },
      {
        // Required exceeding = 1000 * 3 = 3000
        // Yes * 6 = 750 * 6 = 4500
        // No * 6 + required = 250 * 6 + 3000 = 4500
        // 4500 >= 4500
        name: "Yes votes exactly meet the required threshold (1/2 of total)",
        stakeYes: ethers.parseEther("750"),
        stakeNo: ethers.parseEther("250"),
        expectedResult: true,
      },
      {
        name: "all votes are No",
        stakeYes: 0n,
        stakeNo: ethers.parseEther("1000"),
        expectedResult: false,
      },
      {
        name: "Yes votes don't exceed No votes by required threshold",
        stakeYes: ethers.parseEther("700"),
        stakeNo: ethers.parseEther("300"),
        expectedResult: false,
      }
    ];

    TestCases.forEach((args) => {
      it(`should return ${args.expectedResult} when ${args.name}`, async function () {
        const { quorumCalculator } = await helpers.loadFixture(deployContracts);

        const votingResult = {
          countYes: args.stakeYes / ethers.parseEther("1"),
          countNo: args.stakeNo / ethers.parseEther("1"),
          stakeYes: args.stakeYes,
          stakeNo: args.stakeNo
        };

        const totalStakedAmount = args.stakeYes + args.stakeNo;

        const result = await quorumCalculator.highMajorityQuorum(votingResult, totalStakedAmount);

        expect(result).to.eq(args.expectedResult);
      });
    });
  });
});