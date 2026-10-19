import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { encryptForRadio, parseRadioKey } from "../src/rsa.ts";

const big = (base64url: string) =>
  BigInt(`0x${Buffer.from(base64url, "base64url").toString("hex")}`);

function radioKey() {
  const jwk = generateKeyPairSync("rsa", { modulusLength: 1024 }).privateKey.export({
    format: "jwk",
  });
  const [n, e, d] = [big(jwk.n ?? ""), big(jwk.e ?? ""), big(jwk.d ?? "")];
  return { publicKey: `${e.toString(16)}:${n.toString(16)}`, n, d };
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  for (let b = base % modulus, e = exponent; e > 0n; e >>= 1n, b = (b * b) % modulus) {
    if (e & 1n) result = (result * b) % modulus;
  }
  return result;
}

/** The padded block, decrypted with the private exponent. */
function decryptBlock(hex: string, n: bigint, d: bigint): Uint8Array {
  const size = Math.ceil(n.toString(16).length / 2);
  const m = modPow(BigInt(`0x${hex}`), d, n)
    .toString(16)
    .padStart(size * 2, "0");
  return Uint8Array.from(Buffer.from(m, "hex"));
}

describe("encryptForRadio", () => {
  it("pads with PKCS#1 v1.5 type 2 and encrypts with the radio's exponent:modulus key", () => {
    const { publicKey, n, d } = radioKey();
    const hex = encryptForRadio(publicKey, "correct horse ñ");
    expect(hex).toMatch(/^[0-9A-F]{256}$/);
    const block = decryptBlock(hex, n, d);
    expect([block[0], block[1]]).toEqual([0, 2]);
    const end = block.indexOf(0, 2);
    expect(end).toBeGreaterThanOrEqual(10); // at least 8 padding bytes
    expect(block.subarray(2, end).every((b) => b !== 0)).toBe(true);
    expect(new TextDecoder().decode(block.subarray(end + 1))).toBe("correct horse ñ");
  });

  it("uses fresh padding each time", () => {
    const { publicKey } = radioKey();
    expect(encryptForRadio(publicKey, "secret")).not.toBe(encryptForRadio(publicKey, "secret"));
  });

  it("refuses secrets too long for the key, and keys in another format", () => {
    const { publicKey } = radioKey();
    expect(() => encryptForRadio(publicKey, "x".repeat(118))).toThrowError(
      expect.objectContaining({ kind: "validation" }),
    );
    expect(() => parseRadioKey("not a key")).toThrowError(
      expect.objectContaining({ kind: "validation" }),
    );
  });
});
