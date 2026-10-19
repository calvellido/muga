import { FsapiError } from "./errors.ts";

/**
 * Secrets a radio receives, such as the Wi-Fi passphrase (`sys.net.wlan.setPassphrase`), are
 * encrypted with the radio's own RSA key (doc 04 §4). `sys.rsa.publicKey` reads
 * `<exponent hex>:<modulus hex>`, and the secret goes out as hex after RSA with PKCS#1 v1.5
 * padding (type 2). This is what UNDOK and the radio's built-in web page both do.
 */
export interface RadioKey {
  exponent: bigint;
  modulus: bigint;
}

const encoder = new TextEncoder();

/** Reads `sys.rsa.publicKey`; throws a validation error on anything else. */
export function parseRadioKey(text: string): RadioKey {
  const match = /^\s*([0-9a-f]+):([0-9a-f]+)\s*$/i.exec(text);
  if (!match?.[1] || !match[2]) {
    throw new FsapiError("validation", "The radio's public key isn't <exponent>:<modulus> hex");
  }
  return { exponent: BigInt(`0x${match[1]}`), modulus: BigInt(`0x${match[2]}`) };
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

/** `length` random bytes, none of them zero (PKCS#1 v1.5 padding). */
export function randomNonZeroBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i++) {
    while (bytes[i] === 0) bytes[i] = crypto.getRandomValues(new Uint8Array(1))[0] ?? 0;
  }
  return bytes;
}

/**
 * Encrypts `secret` (as UTF-8) for the radio whose `sys.rsa.publicKey` is `publicKey`, and
 * returns the ciphertext as upper-case hex, the length of the modulus, as UNDOK sends it.
 */
export function encryptForRadio(
  publicKey: string,
  secret: string,
  random: (length: number) => Uint8Array = randomNonZeroBytes,
): string {
  const { exponent, modulus } = parseRadioKey(publicKey);
  const size = Math.ceil(modulus.toString(16).length / 2);
  const message = encoder.encode(secret);
  if (message.length > size - 11) {
    throw new FsapiError(
      "validation",
      `A secret of ${message.length} bytes is too long for the radio's key`,
    );
  }
  // 00 02 <non-zero random padding> 00 <message>
  const block = new Uint8Array(size);
  block[1] = 2;
  block.set(random(size - message.length - 3), 2);
  block.set(message, size - message.length);
  let m = 0n;
  for (const byte of block) m = (m << 8n) | BigInt(byte);
  return modPow(m, exponent, modulus)
    .toString(16)
    .toUpperCase()
    .padStart(size * 2, "0");
}
