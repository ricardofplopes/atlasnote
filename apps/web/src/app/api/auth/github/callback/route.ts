import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.redirect(new URL("/?error=no_code", request.url));
  }

  // Redirect to the frontend with the code, which will exchange it via the API
  return NextResponse.redirect(
    new URL(`/?github_code=${code}`, request.url)
  );
}
