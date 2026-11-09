import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";

/** Environment key: 64 hexadecimal characters (32 bytes). Do not commit this key. */
function key(): Buffer {
  const hex = process.env.STRAVA_TOKEN_ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error("STRAVA_TOKEN_ENCRYPTION_KEY must be a 32-byte hex value");
  return Buffer.from(hex, "hex");
}

function seal(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function unseal(value: string): string {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Unknown encrypted Strava token format");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export async function saveStravaCredentials(value: {
  refresh_token: string; access_token: string; expires_at: number; scope: string;
}): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO platform_credentials (platform, auth_type, credentials, connected_at, expires_at, status)
    VALUES ('strava', 'oauth', ${sql.json({
      refresh_token_encrypted: seal(value.refresh_token),
      access_token_encrypted: seal(value.access_token),
      scopes: value.scope,
    })}, NOW(), to_timestamp(${value.expires_at}), 'connected')
    ON CONFLICT (platform) DO UPDATE SET
      auth_type = 'oauth',
      credentials = EXCLUDED.credentials,
      connected_at = NOW(),
      expires_at = EXCLUDED.expires_at,
      status = 'connected'
  `;
}
