import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolvePersonalGalaxyScope } from "@/server/db/galaxy-repo";
import { findActiveBook } from "@/server/db/book-repo";
import { updateActiveBook } from "@/server/db/book-repo";
import { updateBookSchema } from "@/server/validation/domain-schemas";
import { DomainError } from "@/server/domain-error";

export async function GET(_request: Request, { params }: { params: Promise<{ bookId: string }> }) {
  const userId = (await auth())?.user?.id;
  if (!userId) return NextResponse.json({ code: "UNAUTHENTICATED", message: "请先登录后再查看家书。" }, { status: 401 });
  const scope = await resolvePersonalGalaxyScope(userId);
  const { bookId } = await params;
  const book = await findActiveBook({ ...scope, bookId });
  if (!book) return NextResponse.json({ code: "BOOK_NOT_FOUND", message: "家书不存在或无权访问。" }, { status: 404 });
  return NextResponse.json({ id: book.id, title: book.title, body: book.body, sections: book.sections, status: book.status, version: book.version, visibility: book.visibility });
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
