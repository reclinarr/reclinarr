import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Media } from "@reclinarr/shared";
import type { AppContext } from "../context.js";
import { isDemoSession, requireAuth } from "../plugins/auth.js";
import {
  buildCatalogDiscoveryRails,
  libraryKeysFromItems,
  type CatalogRail,
} from "../services/catalog-rails.js";
import { applyTmdbArtwork } from "../services/media-enrichment.js";

export async function registerCatalogRoutes(
  app: FastifyInstance,
  ctx: AppContext,
): Promise<void> {
  app.get("/api/catalog/:mediaType", async (req) => {
    const { userContext, session } = await requireAuth(req);
    const params = z.object({ mediaType: z.enum(["movie", "tv"]) }).parse(req.params);
    const query = z
      .object({
        search: z.string().optional(),
      })
      .parse(req.query);

    let library: Media[] = [];
    if (ctx.jellyfin.listLibrary) {
      const result = await ctx.jellyfin
        .listLibrary(userContext, {
          mediaType: params.mediaType,
          limit: 48,
          search: query.search?.trim() || undefined,
        })
        .catch(() => ({ items: [] as Media[], total: 0 }));
      library = await applyTmdbArtwork(ctx, result.items, userContext);
    }

    const libraryKeys = libraryKeysFromItems(library);
    const discovery = isDemoSession(ctx, session)
      ? []
      : await buildCatalogDiscoveryRails(ctx, params.mediaType, libraryKeys);

    const rows: CatalogRail[] = [
      ...(library.length
        ? [{ id: "library", title: "My Library", items: library } satisfies CatalogRail]
        : []),
      ...discovery,
    ];

    return { rows };
  });
}
