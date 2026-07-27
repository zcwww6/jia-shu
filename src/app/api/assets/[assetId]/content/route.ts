import { Readable } from "node:stream";

import { auth } from "@/auth";
import { findActiveAsset } from "@/server/db/asset-repo";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { readPrivateAsset, safeFileName } from "@/server/media/media-store";

export const runtime = "nodejs";

type AssetContentContext = {
  params: Promise<{ assetId: string }>;
};

function notFoundResponse() {
  return new Response(null, { status: 404 });
}

async function getContent(_request: Request, context: AssetContentContext) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return notFoundResponse();
  }

  const scope = await resolvePersonalGalaxyScope(userId);
  const { assetId } = await context.params;
  const asset = await findActiveAsset({
    userId: scope.userId,
    galaxyId: scope.galaxyId,
    assetId,
  });

  if (!asset || (asset.status !== "stored" && asset.status !== "ready")) {
    return notFoundResponse();
  }

  const stream = await readPrivateAsset(asset.storageKey);

  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": asset.mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename=${safeFileName(asset.originalName)}`,
    },
  });
}

export async function GET(request: Request, context: AssetContentContext) {
  try {
    return await getContent(request, context);
  } catch {
    return notFoundResponse();
  }
}
