import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";

import { env } from "@/server/config/env";
import { prisma } from "@/server/db/client";

const protectedPrefixes = ["/galaxy", "/planet", "/memory", "/resonance", "/books", "/settings"];

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  pages: {
    signIn: "/sign-in",
  },
  providers: [
    Resend({
      apiKey: env.AUTH_RESEND_API_KEY,
      from: env.AUTH_RESEND_FROM,
    }),
  ],
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      const isProtectedRoute = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

      if (!isProtectedRoute) {
        return true;
      }

      return !!auth?.user;
    },
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
      }

      return session;
    },
  },
});
