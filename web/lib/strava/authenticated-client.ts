import { getDb } from "@/lib/db";
import { unseal, saveStravaCredentials } from "./token-vault";
import { refreshStravaAccessToken } from "./activity-client";

export async function getStravaAccessToken(): Promise<string> {
  const sql = getDb();
  const rows = await sql`SELECT credentials, EXTRACT(EPOCH FROM expires_at)::bigint AS expiration
    FROM platform_credentials WHERE platform='strava' AND status='connected' LIMIT 1`;
  const row = rows[0];
  if (!row) throw new Error("Strava not connected");
  const c = row.credentials as { access_token_encrypted?: string; refresh_token_encrypted?: string; scopes?: string };
  if (!c?.access_token_encrypted || !c?.refresh_token_encrypted) throw new Error("Missing encrypted Strava credentials");
  const scopes = new Set((c.scopes ?? "").split(" "));
  if (!scopes.has("activity:read_all") || !scopes.has("activity:write")) throw new Error("Missing Strava permissions");
  if (Number(row.expiration) > Date.now()/1000 + 300) return unseal(c.access_token_encrypted);
  const id = process.env.STRAVA_CLIENT_ID, secret = process.env.STRAVA_CLIENT_SECRET;
  if (!id || !secret) throw new Error("Strava application credentials not configured");
  const refreshed = await refreshStravaAccessToken({
    clientId: id, clientSecret: secret, refreshToken: unseal(c.refresh_token_encrypted),
  });
  await saveStravaCredentials({ ...refreshed, scope: c.scopes ?? "" });
  return refreshed.access_token;
}
