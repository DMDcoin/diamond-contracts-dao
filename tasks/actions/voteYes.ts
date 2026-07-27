import type { NewTaskActionFunction } from "hardhat/types/tasks";
import type { Hash } from "viem";

import { Vote } from "../../test/fixtures/proposal.js";
import { KnownContractNames, requireKnownContract } from "../knownContracts.js";

const voteYes: NewTaskActionFunction = async (_taskArguments, hre) => {
  const { viem } = await hre.network.getOrCreate();

  const proxyAddress = requireKnownContract(KnownContractNames.DiamondDao);
  const dao = await viem.getContractAt("DiamondDao", proxyAddress);
  const stakingAddress = await dao.read.stakingHbbft();

  console.log(`Staking address: ${stakingAddress}`);

  const stakingContract = await viem.getContractAt("IStakingHbbft", stakingAddress);
  const allSigners = await viem.getWalletClients();

  const voters = [];
  for (const signer of allSigners) {
    if (await stakingContract.read.isPoolValid([signer.account.address])) {
      voters.push(signer);
    }
  }

  if (voters.length === 0) {
    console.log("No voters found among signers. Exiting.");
    return;
  }

  const proposals = await dao.read.getCurrentPhaseProposals();

  if (proposals.length === 0) {
    console.log("No proposals found in the current phase. Exiting.");
    return;
  }

  console.log("voters:", voters.length);

  for (const proposal of proposals) {
    console.log(`Voting YES on proposal ${proposal}`);

    const waitTxs: Hash[] = [];
    for (const signer of voters) {
      console.log(`Signer ${signer.account.address} is voting YES on proposal ${proposal}`);

      try {
        const hash = await dao.write.vote([proposal, Vote.Yes], { account: signer.account });
        waitTxs.push(hash);
      } catch (e) {
        console.log("Failed to vote: ", e);
      }
    }

    console.log("awaiting transactions.");

    const publicClient = await viem.getPublicClient();
    for (const hash of waitTxs) {
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }
};

export default voteYes;
