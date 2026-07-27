import type { Address, Hex, PublicClient } from "viem";

import {
  addressFromStorageSlot,
  ERC1967AdminSlot,
  ERC1967ImplementationSlot,
} from "../test/fixtures/proxy.js";

export async function getProxyAdminAddress(
  publicClient: PublicClient,
  proxyAddress: Address,
): Promise<Address> {
  const slotValue = await publicClient.getStorageAt({
    address: proxyAddress,
    slot: ERC1967AdminSlot as Hex,
  });

  if (slotValue === undefined) {
    throw new Error(`Unable to read ERC1967 admin slot for ${proxyAddress}`);
  }

  return addressFromStorageSlot(slotValue);
}

export async function getProxyImplementationAddress(
  publicClient: PublicClient,
  proxyAddress: Address,
): Promise<Address> {
  const slotValue = await publicClient.getStorageAt({
    address: proxyAddress,
    slot: ERC1967ImplementationSlot as Hex,
  });

  if (slotValue === undefined) {
    throw new Error(`Unable to read ERC1967 implementation slot for ${proxyAddress}`);
  }

  return addressFromStorageSlot(slotValue);
}
