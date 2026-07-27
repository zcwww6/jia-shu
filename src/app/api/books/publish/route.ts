import { NextResponse } from "next/server";

const LEGACY_PUBLISH_RETIRED_RESPONSE = {
  code: "BOOK_PUBLISH_ENDPOINT_RETIRED",
  message: "旧家书发布端点已停用，请先保存家书，再通过受保护的分享接口发布。",
  migrationEndpoint: "/api/books/:bookId/shares",
} as const;

export async function POST(request: Request) {
  void request;

  return NextResponse.json(LEGACY_PUBLISH_RETIRED_RESPONSE, { status: 410 });
}
