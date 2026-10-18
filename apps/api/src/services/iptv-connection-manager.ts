export type IptvConnKind = "live" | "playback" | "acquisition";

const PRIORITY: Record<IptvConnKind, number> = {
  live: 3,
  playback: 2,
  acquisition: 1,
};

export interface IptvLease {
  id: string;
  kind: IptvConnKind;
  label?: string;
  /** Abort when this lease is released or preempted — cancel upstream work. */
  signal: AbortSignal;
  release: () => void;
}

/**
 * Soft cap on concurrent IPTV upstream connections (live / VOD / downloads).
 * Higher-priority kinds can preempt lower ones when at capacity.
 * Equal priority can replace the oldest lease (needed for VOD scrub with max=1).
 */
export class IptvConnectionManager {
  private readonly leases = new Map<
    string,
    { kind: IptvConnKind; label?: string; acquiredAt: number; abort: AbortController }
  >();
  private seq = 0;
  /**
   * Live hold for nginx X-Accel: the API request ends after 204, but nginx keeps
   * the upstream open. Keep one live lease until another channel is tuned.
   */
  private readonly liveHolds = new Map<string, IptvLease>();

  constructor(private readonly maxConnections: number) {}

  get active(): number {
    return this.leases.size;
  }

  get max(): number {
    return this.maxConnections;
  }

  /**
   * Acquire a connection slot. Throws if the budget is full and nothing
   * equal/lower-priority can be preempted.
   */
  acquire(kind: IptvConnKind, opts?: { label?: string; signal?: AbortSignal }): IptvLease {
    this.reap();
    if (this.leases.size >= this.maxConnections) {
      const victim = this.pickVictim(kind);
      if (!victim) {
        const err = new Error(
          "IPTV connection limit reached. Another stream is already open; close it and try again.",
        ) as Error & { statusCode: number };
        err.statusCode = 503;
        throw err;
      }
      this.forceRelease(victim);
    }

    const id = `iptv-${++this.seq}-${Date.now()}`;
    const abort = new AbortController();
    this.leases.set(id, {
      kind,
      label: opts?.label,
      acquiredAt: Date.now(),
      abort,
    });

    const onAbort = () => this.release(id);
    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    return {
      id,
      kind,
      label: opts?.label,
      signal: abort.signal,
      release: () => {
        opts?.signal?.removeEventListener("abort", onAbort);
        this.release(id);
      },
    };
  }

  release(id: string): void {
    const lease = this.leases.get(id);
    if (!lease) return;
    this.leases.delete(id);
    try {
      if (!lease.abort.signal.aborted) lease.abort.abort();
    } catch {
      /* ignore */
    }
  }

  /**
   * Hold a live IPTV slot for nginx-proxied MPEG-TS (no client disconnect signal).
   * Retunes replace the previous hold; downloads remain preemptible by live priority.
   */
  holdLive(uuid: string): IptvLease {
    const existing = this.liveHolds.get(uuid);
    if (existing && !existing.signal.aborted) return existing;
    const lease = this.acquire("live", { label: `live:${uuid}` });
    this.liveHolds.set(uuid, lease);
    return lease;
  }

  releaseLiveHold(uuid?: string): void {
    for (const [channel, lease] of this.liveHolds) {
      if (uuid && channel !== uuid) continue;
      lease.release();
      this.liveHolds.delete(channel);
    }
  }

  releaseLiveChannel(uuid: string): void {
    this.releaseLiveHold(uuid);
    for (const [id, lease] of [...this.leases]) {
      if (lease.kind === "live" && (lease.label === `live:${uuid}` || lease.label === `live-hls:${uuid}`)) this.release(id);
    }
  }

  /** Drop every live lease (player close / retune). Aborts upstream fetches. */
  releaseAllLive(): void {
    this.releaseLiveHold();
    for (const [id, lease] of [...this.leases]) {
      if (lease.kind === "live") this.release(id);
    }
  }

  snapshot(): Array<{ id: string; kind: IptvConnKind; label?: string; acquiredAt: number }> {
    return [...this.leases.entries()].map(([id, v]) => ({
      id,
      kind: v.kind,
      label: v.label,
      acquiredAt: v.acquiredAt,
    }));
  }

  private pickVictim(incoming: IptvConnKind): string | null {
    const incomingPri = PRIORITY[incoming];
    let best: { id: string; pri: number; at: number } | null = null;
    for (const [id, lease] of this.leases) {
      const pri = PRIORITY[lease.kind];
      // Higher priority is protected; equal/lower can be replaced (scrub / channel zap).
      if (pri > incomingPri || lease.kind === "live") continue;
      if (!best || pri < best.pri || (pri === best.pri && lease.acquiredAt < best.at)) {
        best = { id, pri, at: lease.acquiredAt };
      }
    }
    return best?.id ?? null;
  }

  private forceRelease(id: string): void {
    this.release(id);
  }

  private reap(): void {
    // Placeholder for timed leases; currently release is explicit.
  }
}
