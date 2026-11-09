import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Start OAuth only from an authenticated local dashboard session. */
export async function GET(request: Request) {
  if (!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const clientId = process.env.STRAVA_CLIENT_ID;
  const callbackOrigin = process.env.STRAVA_CALLBACK_ORIGIN;
  if (!clientId || !callbackOrigin) return NextResponse.json({ error: "Strava app is not configured" }, { status: 503 });
  const origin = new URL(request.url).origin;
  if (new URL(callbackOrigin).origin !== origin) {
    return NextResponse.json({ error: "Callback origin mismatch" }, { status: 503 });
  }
  const state = randomBytes(32).toString("base64url");
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${origin}/api/strava/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all,activity:write");
  url.searchParams.set("state", state);
  const response = NextResponse.redirect(url);
  response.cookies.set("h2g_strava_state", state, {
    httpOnly: true, secure: origin.startsWith("https://"), sameSite: "lax",
    maxAge: 600, path: "/api/strava/callback",
  });
  return response;
}
