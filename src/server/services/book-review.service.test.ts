import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@/server/domain-error";

import { reviewBookSpread } from "./book-review.service";

const scope = { userId: "user-1", galaxyId: "galaxy-1" };

describe("book review service", () => {
  it("persists the next reviewed spread and keeps the book unshareable until the last spread", async () => {
    const updateReview = vi.fn().mockResolvedValue({ id: "book-1", status: "draft", version: 2, draft: { reviewedSpreadIndexes: [0] } });

    const result = await reviewBookSpread(scope, "book-1", { pageIndex: 0, version: 1 }, {
      findReviewableBook: vi.fn().mockResolvedValue({
        id: "book-1",
        status: "draft",
        version: 1,
        draft: { sourceMemoryIds: ["memory-1"] },
        sections: [{ title: "围桌", body: "一家人围桌而坐。" }],
      }),
      updateReview,
    });

    expect(updateReview).toHaveBeenCalledWith(expect.objectContaining({
      ...scope,
      bookId: "book-1",
      version: 1,
      status: "draft",
      draft: expect.objectContaining({ reviewedSpreadIndexes: [0] }),
    }));
    expect(result).toEqual({ id: "book-1", status: "draft", version: 2, reviewedSpreadIndexes: [0], spreadCount: 3 });
  });

  it("rejects an attempt to skip a not-yet-reviewed spread", async () => {
    await expect(reviewBookSpread(scope, "book-1", { pageIndex: 1, version: 1 }, {
      findReviewableBook: vi.fn().mockResolvedValue({
        id: "book-1",
        status: "draft",
        version: 1,
        draft: { sourceMemoryIds: ["memory-1"] },
        sections: [{ title: "围桌", body: "一家人围桌而坐。" }],
      }),
      updateReview: vi.fn(),
    })).rejects.toMatchObject<Partial<DomainError>>({ code: "BOOK_REVIEW_ORDER_INVALID", status: 409 });
  });
});
