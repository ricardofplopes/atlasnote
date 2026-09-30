import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  // Use NEXTAUTH_URL to build the redirect so it works inside Docker
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const redirectUrl = new URL("/", baseUrl);
  redirectUrl.searchParams.set("github_code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  return NextResponse.redirect(redirectUrl);
}
