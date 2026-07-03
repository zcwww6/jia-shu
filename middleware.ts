export { auth as middleware } from "@/auth";

export const config = {
  matcher: ["/galaxy/:path*", "/planet/:path*", "/memory/:path*", "/resonance/:path*", "/books/:path*", "/settings/:path*"],
};
