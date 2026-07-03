import type { NextAuthConfig } from "next-auth";

const protectedPrefixes = ["/galaxy", "/planet", "/memory", "/resonance", "/books", "/settings"];

export const authConfig = {
  pages: {
    signIn: "/sign-in",
  },
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      const isProtectedRoute = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

      if (!isProtectedRoute) {
        return true;
      }

      return !!auth?.user;
    },
  },
} satisfies NextAuthConfig;
