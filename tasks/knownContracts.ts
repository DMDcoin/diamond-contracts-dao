import type { Address } from "viem";

export const KnownContractNames = {
  DiamondDao: "DiamondDao",
  DiamondDaoLowMajority: "DiamondDaoLowMajority",
} as const;

export type KnownContractName = (typeof KnownContractNames)[keyof typeof KnownContractNames];

export const KnownContracts = new Map<string, Address>([
  [KnownContractNames.DiamondDao, "0xDA0da0da0Da0Da0Da0DA00DA0da0da0DA0DA0dA0"],
  [KnownContractNames.DiamondDaoLowMajority, "0x0000000000000000000000000000000000000000"],
]);

export function requireKnownContract(contract: string): Address {
  if (!KnownContracts.has(contract)) {
    throw new Error(`${contract} is unknown`);
  }

  return KnownContracts.get(contract)!;
}
