import { ethers } from "hardhat";

export const EmptyBytes = ethers.hexlify(new Uint8Array());

export function getRandomBigInt(): bigint {
  return BigInt("0x" + Buffer.from(ethers.randomBytes(16)).toString("hex"));
}
