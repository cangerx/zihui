import { NextRequest, NextResponse } from "next/server";
import { isWebRouteEnabled } from "@/lib/features";

export function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;

  if (pathname === "/register") {
    const ref = searchParams.get("ref");
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    if (ref) url.searchParams.set("ref", ref);
    url.searchParams.set("login", "1");
    return NextResponse.redirect(url);
  }

  if (!isWebRouteEnabled(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const referralMatch = pathname.match(/^\/referral\/([^/]+)$/);
  if (referralMatch?.[1]) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    url.searchParams.set("ref", referralMatch[1]);
    url.searchParams.set("login", "1");
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|.*\\..*).*)"],
};
