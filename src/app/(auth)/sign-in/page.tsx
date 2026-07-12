import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { submitMagicLink } from "./actions";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";

export default async function SignInPage() {
  const session = await auth();

  if (session?.user) {
    redirect("/galaxy");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(245,158,11,0.18),_transparent_40%),linear-gradient(180deg,_#171717_0%,_#09090b_100%)] px-6 py-16 text-stone-100">
      <Card className="w-full max-w-md border-white/10 px-6 py-8 sm:px-8">
        <div className="space-y-3">
          <p className="text-sm uppercase tracking-[0.18em] text-amber-200/80">Jiashu</p>
          <h1 className="text-3xl font-semibold text-white">邮箱登录</h1>
          <p className="text-sm leading-6 text-stone-300">输入你的邮箱，我们会发送一封魔法链接邮件，带你回到家书星球。</p>
        </div>

        <form action={submitMagicLink} className="mt-8 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-stone-200">邮箱</span>
            <input
              autoComplete="email"
              className="h-11 w-full rounded-md border border-white/12 bg-white/6 px-4 text-sm text-white outline-none transition placeholder:text-stone-500 focus:border-amber-200 focus:ring-2 focus:ring-amber-200/30"
              name="email"
              placeholder="you@example.com"
              required
              type="email"
            />
          </label>

          <Button className="w-full" type="submit">
            发送魔法链接
          </Button>
        </form>
      </Card>
    </main>
  );
}
