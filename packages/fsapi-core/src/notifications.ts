import type { FsapiClient, Notification } from "./client.ts";
import { type FsapiError, isFsapiError } from "./errors.ts";

export interface NotificationSessionOptions {
  onNotification: (notification: Notification) => void;
  /** The session was taken over (another controller called CREATE_SESSION). */
  onSessionLost?: () => void;
  onSessionStarted?: (sessionId: string) => void;
  onError?: (error: FsapiError) => void;
  /** Wait after network or unexpected errors. */
  retryDelayMs?: number;
  /** After a takeover, wait this long before re-creating, doubling up to `maxTakeoverBackoffMs`. */
  takeoverBackoffMs?: number;
  maxTakeoverBackoffMs?: number;
  /** Delete our session (by sid) when stopping. */
  deleteSessionOnStop?: boolean;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Owns a radio's single FSAPI session and runs the GET_NOTIFIES loop.
 *
 * Plain GET/SET calls need no session, so prefer polling when several controllers share a radio.
 * When the session is taken over, this backs off instead of fighting for it.
 */
export class NotificationSession {
  private controller: AbortController | undefined;
  private loop: Promise<void> | undefined;
  private sid: string | undefined;

  constructor(
    private readonly client: FsapiClient,
    private readonly options: NotificationSessionOptions,
  ) {}

  get sessionId(): string | undefined {
    return this.sid;
  }

  get running(): boolean {
    return this.controller !== undefined;
  }

  start(): void {
    if (this.controller) return;
    const controller = new AbortController();
    this.controller = controller;
    this.loop = this.run(controller.signal);
  }

  async stop(): Promise<void> {
    const controller = this.controller;
    if (!controller) return;
    this.controller = undefined;
    controller.abort();
    await this.loop;
    const sid = this.sid;
    this.sid = undefined;
    if (sid && (this.options.deleteSessionOnStop ?? true)) {
      await this.client.deleteSession(sid).catch(() => undefined);
    }
  }

  private async run(signal: AbortSignal): Promise<void> {
    const {
      onNotification,
      onSessionLost,
      onSessionStarted,
      onError,
      retryDelayMs = 2_000,
      takeoverBackoffMs = 5_000,
      maxTakeoverBackoffMs = 300_000,
    } = this.options;
    let backoff = takeoverBackoffMs;

    while (!signal.aborted) {
      try {
        if (!this.sid) {
          this.sid = await this.client.createSession({ signal });
          onSessionStarted?.(this.sid);
        }
        const notifications = await this.client.getNotifies(this.sid, { signal });
        backoff = takeoverBackoffMs;
        for (const notification of notifications) onNotification(notification);
      } catch (error) {
        if (signal.aborted) break;
        if (isFsapiError(error, "not-found") && this.sid) {
          this.sid = undefined;
          onSessionLost?.();
          await sleep(backoff, signal);
          backoff = Math.min(backoff * 2, maxTakeoverBackoffMs);
        } else if (isFsapiError(error, "timeout")) {
          // The long-poll outlived our client timeout; just poll again.
        } else {
          if (isFsapiError(error)) onError?.(error);
          else throw error;
          await sleep(retryDelayMs, signal);
        }
      }
    }
  }
}
