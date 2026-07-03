import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { PrismaClient } from "@prisma/client";
import Resend from "next-auth/providers/resend";

import { authConfig } from "@/auth.config";
import { env } from "@/server/config/env";

const globalForAuthPrisma = globalThis as {
  authPrisma?: PrismaClient;
};

function getPrismaClient() {
  if (!globalForAuthPrisma.authPrisma) {
    globalForAuthPrisma.authPrisma = new PrismaClient({});
  }

  return globalForAuthPrisma.authPrisma;
}

export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig,
  adapter: PrismaAdapter(getPrismaClient()),
  providers: [
    Resend({
      apiKey: env.AUTH_RESEND_API_KEY,
      from: env.AUTH_RESEND_FROM,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    },
  },
}));
