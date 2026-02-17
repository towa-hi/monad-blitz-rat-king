import { assertEquals, assertThrows } from "@std/assert";
import { isBytes32Hex, isUint8, normalizeWalletAddress } from "./main.ts";

/**
 * Tests that address normalization returns checksum format.
 * @returns Nothing.
 */
function normalizeWalletAddressTest(): void {
  const normalized = normalizeWalletAddress(
    "0x52908400098527886E0F7030069857D2E4169EE7",
  );
  assertEquals(normalized, "0x52908400098527886E0F7030069857D2E4169EE7");
}

/**
 * Tests that invalid addresses throw.
 * @returns Nothing.
 */
function normalizeWalletAddressInvalidTest(): void {
  assertThrows(() => normalizeWalletAddress("not-an-address"));
}

/**
 * Tests bytes32 hex validation helper.
 * @returns Nothing.
 */
function isBytes32HexTest(): void {
  assertEquals(isBytes32Hex("0x" + "ab".repeat(32)), true);
  assertEquals(isBytes32Hex("0x1234"), false);
}

/**
 * Tests uint8 range validation helper.
 * @returns Nothing.
 */
function isUint8Test(): void {
  assertEquals(isUint8(0), true);
  assertEquals(isUint8(255), true);
  assertEquals(isUint8(256), false);
  assertEquals(isUint8(-1), false);
  assertEquals(isUint8(1.2), false);
}

Deno.test(
  "normalizeWalletAddress returns checksum address",
  normalizeWalletAddressTest,
);
Deno.test(
  "normalizeWalletAddress throws for invalid address",
  normalizeWalletAddressInvalidTest,
);
Deno.test("isBytes32Hex validates bytes32 hex strings", isBytes32HexTest);
Deno.test("isUint8 validates uint8 range", isUint8Test);
