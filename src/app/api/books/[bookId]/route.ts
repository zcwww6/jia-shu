import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { findActiveBookWithMedia, updateActiveBook } from "@/server/db/book-repo";
import { updateBookSchema } from "@/server/validation/domain-schemas";
import { DomainError } from "@/server/domain-error";

export async function GET(_request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再查看家书。" }, { status: 401 });
  const scope = await resolvePersonalGalaxyScope(userId);
  const { bookId } = await params;
  const book = await findActiveBookWithMedia({ ...scope, bookId });
  if (!book) return NextResponse.json({ code: "BOOK_NOT_FOUND", message: "家书不存在或无权访问。" }, { status: 404 });
  return NextResponse.json({
    id: book.id,
    title: book.title,
    body: book.body,
    intro: introFromDraft(book.draft),
    sections: book.sections,
    sourceLabels: sourceLabelsFromDraft(book.draft),
    status: book.status,
    version: book.version,
    visibility: book.visibility,
    media: mediaFromBook(book),
  });
}

function mediaFromBook(book: NonNullable<Awaited<ReturnType<typeof findActiveBookWithMedia>>>) {
  const included = new Set<string>();

  return book.memories.flatMap(({ memory }) => memory.assets.flatMap((asset) => {
    if (asset.kind !== "image" && asset.kind !== "audio") return [];
    if (included.has(asset.id)) return [];
    included.add(asset.id);

    return [{
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      originalName: asset.originalName,
      title: memory.title ?? asset.originalName,
      caption: memory.summary ?? "",
      width: asset.width,
      height: asset.height,
      durationMs: asset.durationMs,
      url: `/api/assets/${asset.id}/content`,
    }];
  }));
}

function introFromDraft(draft: unknown) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return "";
  const intro = (draft as Record<string, unknown>).intro;
  return typeof intro === "string" ? intro.trim().slice(0, 5_000) : "";
}

function sourceLabelsFromDraft(draft: unknown): Record<string, string> {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) return {};
  const parsedDraft = draft as Record<string, unknown>;
  const sourceMemoryIds = parsedDraft.sourceMemoryIds;
  const sourceLabels = parsedDraft.sourceLabels;
  if (!Array.isArray(sourceMemoryIds) || !sourceMemoryIds.every((memoryId) => typeof memoryId === "string")) return {};
  if (!sourceLabels || typeof sourceLabels !== "object" || Array.isArray(sourceLabels)) return {};

  return Object.fromEntries(sourceMemoryIds.flatMap((memoryId) => {
    const title = (sourceLabels as Record<string, unknown>)[memoryId];
    return memoryId.trim().length > 0 && typeof title === "string" ? [[memoryId, title]] : [];
  }));
}

export async function PATCH(request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  try {
    const userId = (await auth())?.user?.id;
    if (!userId) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再编辑家书。" }, { status: 401 });
    const payload = updateBookSchema.parse(await request.json()); const scope = await resolvePersonalGalaxyScope(userId); const { bookId } = await params;
    const book = await updateActiveBook({ ...scope, bookId, ...payload });
    return NextResponse.json({ id: book!.id, title: book!.title, body: book!.body, version: book!.version });
  } catch (error) { const status = error instanceof DomainError ? error.status : 400; const message = error instanceof DomainError ? error.message : "家书更新请求格式不正确。"; return NextResponse.json({ code: error instanceof DomainError ? error.code : "BOOK_UPDATE_INVALID", message }, { status }); }
}
