import type { Prisma } from "@prisma/client";

import { findReviewableBook, updateBookReview } from "@/server/db/book-repo";
import { DomainError } from "@/server/domain-error";

type BookScope = { userId: string; galaxyId: string };
type ReviewableBook = {
  id: string;
  status: "draft" | "ready" | "published" | "archived";
  version: number;
  draft: unknown;
  sections: unknown;
};

type BookReviewDeps = {
  findReviewableBook(input: BookScope & { bookId: string }): Promise<ReviewableBook | null>;
  updateReview(input: BookScope & {
    bookId: string;
    version: number;
    status: "draft" | "ready";
    draft: Prisma.InputJsonValue;
  }): Promise<{ id: string; status: "draft" | "ready" | "published" | "archived"; version: number; draft: unknown } | null>;
};

const defaultDeps: BookReviewDeps = { findReviewableBook, updateReview: updateBookReview };

export async function reviewBookSpread(
  scope: BookScope,
  bookId: string,
  input: { pageIndex: number; version: number },
  deps: BookReviewDeps = defaultDeps,
) {
  const book = await deps.findReviewableBook({ ...scope, bookId });
  if (!book || book.status !== "draft") throw new DomainError("BOOK_REVIEW_NOT_AVAILABLE", 409, "这封家书当前不能进入逐页确认。 ");
  if (book.version !== input.version) throw new DomainError("VERSION_CONFLICT", 409, "家书已被更新，请刷新后再确认。 ");

  const draft = recordDraft(book.draft);
  const reviewedSpreadIndexes = reviewedIndexesFromDraft(draft);
  const spreadCount = spreadCountFromSections(book.sections);
  const nextPageIndex = reviewedSpreadIndexes.length;
  if (input.pageIndex !== nextPageIndex || input.pageIndex >= spreadCount) {
    throw new DomainError("BOOK_REVIEW_ORDER_INVALID", 409, "请按家书顺序逐页确认后再继续。 ");
  }

  const nextReviewedSpreadIndexes = [...reviewedSpreadIndexes, input.pageIndex];
  const status = nextReviewedSpreadIndexes.length === spreadCount ? "ready" : "draft";
  const updated = await deps.updateReview({
    ...scope,
    bookId,
    version: input.version,
    status,
    draft: { ...draft, reviewedSpreadIndexes: nextReviewedSpreadIndexes },
  });
  if (!updated) throw new DomainError("VERSION_CONFLICT", 409, "家书已被更新，请刷新后再确认。 ");

  return {
    id: updated.id,
    status: updated.status,
    version: updated.version,
    reviewedSpreadIndexes: reviewedIndexesFromDraft(recordDraft(updated.draft)),
    spreadCount,
  };
}

function recordDraft(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError("BOOK_REVIEW_INVALID", 422, "家书审阅数据不完整，无法确认。 ");
  }
  return value as Record<string, Prisma.InputJsonValue>;
}

function reviewedIndexesFromDraft(draft: Record<string, Prisma.InputJsonValue>) {
  const value = draft.reviewedSpreadIndexes;
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((index) => Number.isInteger(index) && index >= 0)) {
    throw new DomainError("BOOK_REVIEW_INVALID", 422, "家书审阅数据不完整，无法确认。 ");
  }
  const indexes = [...value] as number[];
  if (indexes.some((index, position) => index !== position)) {
    throw new DomainError("BOOK_REVIEW_INVALID", 422, "家书审阅顺序异常，无法继续确认。 ");
  }
  return indexes;
}

function spreadCountFromSections(value: unknown) {
  if (!Array.isArray(value) || value.length > 40) {
    throw new DomainError("BOOK_REVIEW_INVALID", 422, "家书章节不完整，无法确认。 ");
  }
  return value.length + 2;
}
