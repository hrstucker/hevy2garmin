import type { Sql } from "@/lib/pending-store";
import { supportedStravaType } from "./strava-mappings";

/**
 * Strava mappings are deliberately separate from Garmin exercise mappings.
 * They are stored in app_cache and never affect Garmin upload or merge.
 */
const CACHE_KEY = "strava_exercise_mappings_v1";
export async function loadStravaMappings(sql:Sql):Promise<Record<string,string>> {
  const rows=await sql`SELECT value FROM app_cache WHERE key=${CACHE_KEY} LIMIT 1`;
  const raw=rows[0]?.value;
  if (!raw || typeof raw!=="object" || Array.isArray(raw)) return {};
  const entries=Object.entries(raw as Record<string,unknown>);
  return Object.fromEntries(entries.filter(([key,value])=>key.length<=200 && supportedStravaType(value))) as Record<string,string>;
}

export async function saveStravaMapping(sql:Sql,title:string,chosen:string):Promise<void> {
  if (!title.trim() || title.length>200 || (chosen!=="" && !supportedStravaType(chosen))) {
    throw new Error("Invalid mapping");
  }
  if (chosen) {
    await sql`INSERT INTO app_cache(key,value) VALUES
      (${CACHE_KEY},jsonb_build_object(${title},${chosen}))
      ON CONFLICT(key) DO UPDATE SET
      value=COALESCE(app_cache.value,'{}'::jsonb) || jsonb_build_object(${title},${chosen}),
      updated_at=NOW()`;
  } else {
    await sql`UPDATE app_cache SET value=value - ${title},updated_at=NOW()
      WHERE key=${CACHE_KEY}`;
  }
}
