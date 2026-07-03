import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/galaxy/:path*", "/planet/:path*", "/memory/:path*", "/resonance/:path*", "/books/:path*", "/settings/:path*"],
};
