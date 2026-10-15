import { LatestWins } from "./latest.ts";
import type { RadioContext, TunerState } from "./types.ts";

/** Clamps to the band and snaps to its step grid, as UNDOK does before every SET (doc 05 §2.2). */
export function snapFrequency(khz: number, { lower, upper, step }: TunerState): number {
  const steps = Math.round((khz - lower) / Math.max(1, step));
  return Math.min(upper, Math.max(lower, lower + steps * step));
}

/** FM tuning: the band from `sys.caps.fmFreqRange.*` and `play.frequency` (kHz). */
export class FmTuner {
  private readonly writer: LatestWins<number>;
  /** Poll results are ignored until then, so the dial doesn't jump back while tuning. */
  private settleUntil = 0;
  private unavailable = false;

  constructor(private readonly ctx: RadioContext) {
    this.writer = new LatestWins((khz) => ctx.client.set("netRemote.play.frequency", khz), {
      onError: (error) => ctx.fail("tune", error),
      onSettled: () => {
        this.settleUntil = ctx.now() + 800;
        ctx.playbackChanged();
      },
    });
  }

  /** Reads the band once; it doesn't change. Radios without it get no tuner. */
  async load(): Promise<void> {
    if (this.ctx.snapshot().tuner || this.unavailable) return;
    const { values } = await this.ctx.client.getMultiple([
      "netRemote.sys.caps.fmFreqRange.lower",
      "netRemote.sys.caps.fmFreqRange.upper",
      "netRemote.sys.caps.fmFreqRange.stepSize",
      "netRemote.play.frequency",
    ]);
    const lower = values["netRemote.sys.caps.fmFreqRange.lower"];
    const upper = values["netRemote.sys.caps.fmFreqRange.upper"];
    const step = values["netRemote.sys.caps.fmFreqRange.stepSize"];
    if (!lower || !upper || !step || upper <= lower) {
      this.unavailable = true;
      return;
    }
    this.ctx.update({
      tuner: { lower, upper, step, frequency: values["netRemote.play.frequency"] },
    });
  }

  /** A frequency read by a poll; ignored while the user is tuning. */
  observe(frequency: number | undefined): void {
    const tuner = this.ctx.snapshot().tuner;
    if (!tuner || frequency === undefined || this.writer.busy) return;
    if (this.ctx.now() < this.settleUntil || frequency === tuner.frequency) return;
    this.ctx.update({ tuner: { ...tuner, frequency } });
  }

  /** Latest value wins while dragging the dial. */
  tune(khz: number): Promise<boolean> {
    const tuner = this.ctx.snapshot().tuner;
    if (!tuner) return Promise.resolve(false);
    const frequency = snapFrequency(khz, tuner);
    this.ctx.update({ tuner: { ...tuner, frequency } });
    this.settleUntil = this.ctx.now() + 1_500;
    return this.writer.push(frequency);
  }

  /** One band step down (-1) or up (1). */
  step(direction: -1 | 1): Promise<boolean> {
    const tuner = this.ctx.snapshot().tuner;
    if (!tuner) return Promise.resolve(false);
    return this.tune((tuner.frequency ?? tuner.lower) + direction * tuner.step);
  }
}
