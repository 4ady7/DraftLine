import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const OWNER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function middleware(request: NextRequest) {
  const existing = request.cookies.get("dl_owner")?.value;
  const key = existing && OWNER_RE.test(existing) ? existing : crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-dl-owner", key);
  const response = NextResponse.next({ request: { headers } });
  if (!existing || existing !== key) {
    response.cookies.set("dl_owner", key, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
