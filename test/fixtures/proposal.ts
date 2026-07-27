import { Account, Address, Hex, parseEther } from "viem";

import { DiamondDao } from "./types.js";
import { EmptyBytes } from "./utils.js";
import assert from "node:assert";


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
  targets?: Address[];
  values?: bigint[];
  calldatas?: Hex[];
  majority?: OpenProposalMajority;
  createProposalFee?: bigint;
}

export const CreateProposalFee = parseEther("50");

export async function createProposal(
  dao: DiamondDao,
  proposer: Account,
  opts: CreateProposalOpts = {}
) {
  const _targets = opts.targets || [proposer.address];
  const _values = opts.values || [parseEther('100')];
  const _calldatas = opts.calldatas || [EmptyBytes];
  const _description = opts.description || "fund user";
  const _title = opts.title || "title";
  const _url = opts.url || "url";
  const _majority = opts.majority || OpenProposalMajority.Low;

  const _createProposalFee = opts.createProposalFee || CreateProposalFee;

  const proposalId = await dao.read.hashProposal([
    _targets,
    _values,
    _calldatas,
    _description
  ]);

  await dao.write.propose([
    _targets,
    _values,
    _calldatas,
    _title,
    _description,
    _url,
    _majority,
  ],
    { value: _createProposalFee, account: proposer }
  );

  assert.ok(await dao.read.proposalExists([proposalId]));

  return { proposalId, _targets, _values, _calldatas, _description }
}
