import { NextResponse } from "next/server";

import { saveSharedBook } from "@/server/store/shared-books";
import { isPublishBookRequest } from "@/server/ai/schemas";

export async function POST(request: Request) {
  const payload = await request.json();

  if (!isPublishBookRequest(payload)) {
    return NextResponse.json({ message: "家书发布请求格式不正确" }, { status: 400 });
  }

  const stored = await saveSharedBook({
    draft: payload.draft,
    body: payload.body,
    sections: payload.sections,
    share: payload.share,
  });

  return NextResponse.json({
    token: stored.token,
    url: `/share/${stored.token}`,
  });
}
