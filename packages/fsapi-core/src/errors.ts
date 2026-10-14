import type { FsStatus } from "./types.ts";

/**
 * - `pin`: HTTP 403, wrong PIN.
 * - `not-found`: HTTP 404, invalid session id, unsupported verb or unknown path.
 * - `status`: HTTP 200 with a non-OK `<status>` (see `fsStatus`).
 * - `validation`: rejected locally before anything was sent.
 */
export type FsapiErrorKind =
  | "pin"
  | "not-found"
  | "http"
  | "status"
  | "timeout"
  | "network"
  | "aborted"
  | "parse"
  | "validation";

export interface FsapiErrorDetails {
  httpStatus?: number;
  fsStatus?: FsStatus;
  node?: string;
  /** Request URL with the PIN redacted. */
  url?: string;
  cause?: unknown;
}

export class FsapiError extends Error {
  override readonly name = "FsapiError";
  readonly kind: FsapiErrorKind;
  readonly httpStatus: number | undefined;
  readonly fsStatus: FsStatus | undefined;
  readonly node: string | undefined;
  readonly url: string | undefined;

  constructor(kind: FsapiErrorKind, message: string, details: FsapiErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.kind = kind;
    this.httpStatus = details.httpStatus;
    this.fsStatus = details.fsStatus;
    this.node = details.node;
    this.url = details.url;
  }
}

export function isFsapiError(error: unknown, kind?: FsapiErrorKind): error is FsapiError {
  return error instanceof FsapiError && (kind === undefined || error.kind === kind);
}

export function redactPin(url: string): string {
  return url.replace(/([?&]pin=)[^&]*/i, "$1***");
}
