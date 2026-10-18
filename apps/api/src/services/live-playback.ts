import type { AppContext } from "../context.js";

export function releaseLivePlayback(ctx: AppContext, owner: string, uuid?: string): void {
  const unused = ctx.liveHls.releaseViewer(owner, uuid);
  if (!unused) return;
  ctx.liveHls.stopChannel(unused);
  ctx.iptvConnections.releaseLiveChannel(unused);
}
