import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";

import { authConfig } from "@/auth.config";
import { env } from "@/server/config/env";
import { getPrismaClient } from "@/server/db/client";

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig,
  trustHost: env.AUTH_TRUST_HOST,
  adapter: PrismaAdapter(getPrismaClient()),
  providers: [
    Resend({
      apiKey: env.AUTH_RESEND_API_KEY,
      from: env.AUTH_RESEND_FROM,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    session({ session, token, user }) {
      const userId = user?.id ?? token.sub;

      if (session.user && userId) {
        session.user.id = userId;
      }

      return session;
    },
  },
}));
