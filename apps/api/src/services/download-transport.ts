import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { DownloadTransport } from "@reclinarr/shared";
import { fetchFollowingRedirects } from "@reclinarr/providers";

export class HttpDownloadTransport implements DownloadTransport {
  async start(opts: {
    url: string;
    headers?: Record<string, string>;
    destPath: string;
    resumeFromBytes?: number;
    onProgress?: (bytes: number, total?: number) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const resumeFrom = opts.resumeFromBytes ?? 0;
    const headers = { ...opts.headers };
    if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`;

    const res = await fetchFollowingRedirects(fetch, opts.url, {
      headers,
      signal: opts.signal,
    });
    await this.pipeResponse({
      response: res,
      destPath: opts.destPath,
      resumeFromBytes: resumeFrom,
      onProgress: opts.onProgress,
      signal: opts.signal,
    });
  }

  async pipeResponse(opts: {
    response: Response;
    destPath: string;
    resumeFromBytes?: number;
    onProgress?: (bytes: number, total?: number) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const res = opts.response;
    const resumeFrom = opts.resumeFromBytes ?? 0;
    if (!(res.ok || res.status === 206) || !res.body) {
      throw new Error(`Download failed: HTTP ${res.status}`);
    }

    await mkdir(dirname(opts.destPath), { recursive: true });

    // Only append when the server honored Range with 206. A 200 on resume means
    // the upstream ignored Range — rewrite from byte 0 to avoid a corrupted prefix.
    let writeFrom = resumeFrom;
    let flags: "a" | "w" = "w";
    if (resumeFrom > 0) {
      if (res.status === 206) {
        flags = "a";
        writeFrom = resumeFrom;
      } else {
        // Full body again — truncate and rewrite.
        flags = "w";
        writeFrom = 0;
      }
    }

    let total: number | undefined;
    const contentRange = res.headers.get("content-range");
    if (contentRange) {
      const m = /\/(\d+)$/.exec(contentRange);
      if (m) total = Number(m[1]);
    } else if (writeFrom === 0) {
      const cl = res.headers.get("content-length");
      if (cl) total = Number(cl);
    } else {
      // Resuming without Content-Range — do not invent a total from Content-Length.
      const cl = res.headers.get("content-length");
      if (cl) total = writeFrom + Number(cl);
    }

    let bytes = writeFrom;
    const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
    nodeStream.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      opts.onProgress?.(bytes, total);
    });
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => nodeStream.destroy(), { once: true });
    }

    await pipeline(nodeStream, createWriteStream(opts.destPath, { flags }));
    opts.onProgress?.(bytes, total ?? bytes);
  }
}
