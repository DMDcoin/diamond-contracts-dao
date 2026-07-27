import { bytesToBigInt, bytesToHex, stringToBytes } from 'viem'

export const EmptyBytes = bytesToHex(stringToBytes(''));

export function getRandomBigInt(): bigint {
  const randomBytes = crypto.getRandomValues(new Uint8Array(16))

  return bytesToBigInt(randomBytes)
}
