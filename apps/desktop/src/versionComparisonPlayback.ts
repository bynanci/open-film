// Modified by OpenFilm contributors on 2026-11-13. See LICENSE and NOTICE.
import type { VersionComparisonPreviewDescriptor } from "@openfilm/application";

export type ComparisonSide = "a" | "b";
type Player = Pick<
  HTMLVideoElement,
  "currentTime" | "duration" | "paused" | "ended" | "muted" | "play" | "pause"
>;

export interface ComparisonTransportState {
  time: number;
  duration: number;
  playing: boolean;
  starting: boolean;
  audibleSide: ComparisonSide | null;
  muted: boolean;
  ended: Record<ComparisonSide, boolean>;
}

/** One transport clock over two saved render outputs. No Composition is held here. */
export class VersionComparisonPlayback {
  private descriptor?: VersionComparisonPreviewDescriptor;
  private operation = 0;
  constructor(
    private readonly players: () => Record<ComparisonSide, Player | null>,
    readonly state: ComparisonTransportState,
    private readonly failed: () => void,
  ) {}

  configure(descriptor: VersionComparisonPreviewDescriptor) {
    this.pause();
    this.descriptor = descriptor;
    this.state.time = 0;
    this.state.duration = Math.max(
      descriptor.a.duration,
      descriptor.b.duration,
    );
    this.state.audibleSide = descriptor.a.hasAudio
      ? "a"
      : descriptor.b.hasAudio
        ? "b"
        : null;
    this.state.muted = false;
    this.state.ended = { a: false, b: false };
    this.applyMute();
  }

  private duration(side: ComparisonSide) {
    return this.descriptor?.[side].duration ?? 0;
  }

  private hasAudio(side: ComparisonSide) {
    return this.descriptor?.[side].hasAudio ?? false;
  }

  private applyMute() {
    const players = this.players();
    for (const side of ["a", "b"] as const) {
      const player = players[side];
      if (player)
        player.muted =
          this.state.muted ||
          this.state.audibleSide !== side ||
          !this.hasAudio(side) ||
          this.state.time >= this.duration(side);
    }
  }

  async play() {
    if (!this.descriptor || this.state.time >= this.state.duration) return;
    const operation = ++this.operation,
      players = this.players();
    this.state.starting = true;
    this.applyMute();
    try {
      await Promise.all(
        (["a", "b"] as const)
          .filter(
            (side) => players[side] && this.state.time < this.duration(side),
          )
          .map(async (side) => {
            const player = players[side]!;
            if (Math.abs(player.currentTime - this.state.time) > 0.04)
              player.currentTime = this.state.time;
            await player.play();
          }),
      );
      if (operation !== this.operation) {
        this.pausePlayers();
        return;
      }
      this.state.starting = false;
      this.state.playing = true;
      this.applyMute();
    } catch {
      if (operation !== this.operation) return;
      this.state.starting = false;
      this.state.playing = false;
      this.state.muted = true;
      this.pausePlayers();
      this.applyMute();
      this.failed();
    }
  }

  pause() {
    this.operation++;
    this.state.starting = false;
    this.state.playing = false;
    this.pausePlayers();
    this.applyMute();
  }

  async seek(time: number) {
    if (!this.descriptor || !Number.isFinite(time)) return;
    const resume = this.state.playing || this.state.starting,
      target = Math.max(0, Math.min(this.state.duration, time));
    this.pause();
    this.state.time = target;
    for (const side of ["a", "b"] as const) {
      const player = this.players()[side],
        duration = this.duration(side);
      if (!player) continue;
      if (target >= duration) {
        player.pause();
        player.currentTime = duration;
        this.state.ended[side] = true;
      } else {
        player.currentTime = target;
        this.state.ended[side] = false;
      }
    }
    this.applyMute();
    if (resume) await this.play();
  }

  selectAudio(side: ComparisonSide | null) {
    if (side && !this.hasAudio(side)) return;
    this.state.audibleSide = side;
    this.applyMute();
  }

  setMuted(muted: boolean) {
    this.state.muted = muted;
    this.applyMute();
  }

  onPlay(side: ComparisonSide) {
    if (this.state.starting || this.state.playing) {
      this.applyMute();
      return;
    }
    this.players()[side]?.pause();
    this.applyMute();
  }

  onTimeUpdate(side: ComparisonSide) {
    if (!this.descriptor) return;
    const clockSide: ComparisonSide =
      this.duration("a") >= this.duration("b") ? "a" : "b";
    if (side !== clockSide) return;
    const clock = this.players()[clockSide];
    if (!clock) return;
    this.state.time = Math.max(
      0,
      Math.min(this.state.duration, clock.currentTime),
    );
    for (const currentSide of ["a", "b"] as const) {
      const player = this.players()[currentSide],
        duration = this.duration(currentSide);
      if (!player || currentSide === clockSide) continue;
      if (this.state.time >= duration) {
        player.pause();
        player.currentTime = duration;
        this.state.ended[currentSide] = true;
      } else {
        this.state.ended[currentSide] = false;
        if (Math.abs(player.currentTime - this.state.time) > 0.08)
          player.currentTime = this.state.time;
      }
    }
    this.applyMute();
    if (clock.ended || this.state.time >= this.state.duration)
      this.onEnded(clockSide);
  }

  onEnded(side: ComparisonSide) {
    const player = this.players()[side];
    if (player) {
      player.pause();
      player.currentTime = this.duration(side);
    }
    this.state.ended[side] = true;
    const clockSide: ComparisonSide =
      this.duration("a") >= this.duration("b") ? "a" : "b";
    if (side === clockSide) {
      this.state.time = this.state.duration;
      this.pause();
    } else this.applyMute();
  }

  unload() {
    this.pause();
    this.descriptor = undefined;
    this.state.time = 0;
    this.state.duration = 0;
    this.state.audibleSide = null;
    this.state.muted = true;
    this.state.ended = { a: false, b: false };
  }

  private pausePlayers() {
    for (const player of Object.values(this.players())) {
      if (player) {
        player.muted = true;
        player.pause();
      }
    }
  }
}
