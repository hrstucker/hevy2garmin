import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { saveStravaCredentials } from "@/lib/strava/token-vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const required = ["activity:read_all", "activity:write"];
function constantEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const redirect = (outcome: string) => {
    const response = NextResponse.redirect(new URL(`/strava?strava=${outcome}`, url.origin));
    response.cookies.delete("h2g_strava_state");
    return response;
  };
  // The login cookie is SameSite=Strict and is intentionally absent on a
  // top-level redirect from strava.com. The 10-minute HttpOnly SameSite=Lax
  // OAuth state cookie was issued only by the authenticated /connect route.
  // Its unpredictable, constant-time-checked value binds this callback to
  // that already-authenticated initiation without relaxing global sessions.
  const stored = jar.get("h2g_strava_state")?.value ?? "";
  const state = url.searchParams.get("state") ?? "";
  if (!stored || !state || !constantEqual(stored, state)) return redirect("invalid-state");
  if (url.searchParams.has("error")) return redirect("denied");
  const code = url.searchParams.get("code");
  if (!code) return redirect("missing-code");
  const granted = new Set((url.searchParams.get("scope") ?? "").split(/[\s,]+/).filter(Boolean));
  if (!required.every(s => granted.has(s))) return redirect("insufficient-scope");

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  if (!clientId || !clientSecret || !process.env.STRAVA_TOKEN_ENCRYPTION_KEY) return redirect("not-configured");
  try {
    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code",
      }),
      cache: "no-store",
    });
    if (!response.ok) return redirect("token-exchange-failed");
    const token = await response.json() as {
      refresh_token?: string; access_token?: string; expires_at?: number;
    };
    if (!token.refresh_token || !token.access_token || !token.expires_at) return redirect("invalid-token");
    await saveStravaCredentials({
      refresh_token: token.refresh_token,
      access_token: token.access_token,
      expires_at: token.expires_at,
      scope: [...granted].join(" "),
    });
    return redirect("connected");
  } catch {
    return redirect("connection-failed");
  }
}
