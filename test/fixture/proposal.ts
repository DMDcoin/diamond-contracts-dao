import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

import { DiamondDao } from "../../typechain-types";
import { EmptyBytes } from "./utils";


export enum ProposalType {
  OpenLowMajority,
  ContractUpgrade,
  EcosystemParameterChange,
  OpenHighMajority
};

export enum ProposalState {
  Created,
  Canceled,
  Active,
  VotingFinished,
  Accepted,
  Declined,
  Executed
};

export enum Vote {
  No,
  Yes
};

export enum OpenProposalMajority {
  Low,
  High
};

export type CreateProposalOpts = {
  title?: string;
  description?: string;
  url?: string;
  targets?: string[];
  values?: bigint[];
  calldatas?: string[];
  majority?: OpenProposalMajority;
  createProposalFee?: bigint;
}

export const CreateProposalFee = ethers.parseEther("50");

export async function createProposal(
  dao: DiamondDao,
  proposer: HardhatEthersSigner,
  opts: CreateProposalOpts = {}
) {
  const _targets = opts.targets || [proposer.address];
  const _values = opts.values || [ethers.parseEther('100')];
  const _calldatas = opts.calldatas || [EmptyBytes];
  const _description = opts.description || "fund user";
  const _title = opts.title || "title";
  const _url = opts.url || "url";
  const _majority = opts.majority || OpenProposalMajority.Low;

  const _createProposalFee = opts.createProposalFee || CreateProposalFee;

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
    _title,
    _description,
    _url,
    _majority,
    { value: _createProposalFee }
  );

  return { proposalId, _targets, _values, _calldatas, _description }
}
