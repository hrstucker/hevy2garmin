import type { Sql } from "@/lib/pending-store";
import { supportedStravaType } from "./strava-mappings";

/** Independent Strava mapping store. Never touches Garmin exercise mappings. */
const CACHE_KEY = "strava_exercise_mappings_v1";

export async function loadStravaMappings(sql:Sql):Promise<Record<string,string>> {
  const rows=await sql`SELECT value FROM app_cache WHERE key=${CACHE_KEY} LIMIT 1`;
  const raw=rows[0]?.value;
  if(!raw || typeof raw!=="object" || Array.isArray(raw))return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string,unknown>).filter(([title,value])=>
      title.length<=200 && supportedStravaType(value))
  ) as Record<string,string>;
}

export async function saveStravaMapping(sql:Sql,title:string,chosen:string):Promise<string|null>{
  if(!title.trim() || title.length>200 || (chosen!=="" && !supportedStravaType(chosen)))
    throw new Error("Invalid mapping");

  // Parameterize the JSONB document explicitly. No dynamic SQL fragments.
  // Atomic jsonb merge preserves other saved exercises under concurrent writes.
  if(chosen) {
    const patch=sql.json({[title]:chosen});
    await sql`INSERT INTO app_cache(key,value,updated_at)
      VALUES (${CACHE_KEY},${patch},NOW())
      ON CONFLICT(key) DO UPDATE SET
        value=COALESCE(app_cache.value,'{}'::jsonb) || EXCLUDED.value,
        updated_at=NOW()`;
  } else {
    await sql`UPDATE app_cache SET value=value - ${title},updated_at=NOW()
      WHERE key=${CACHE_KEY}`;
  }

  // Do not report "saved" solely from an UPDATE/INSERT success: read it back.
  const current=await loadStravaMappings(sql);
  const persisted=current[title]??null;
  if(persisted!==(chosen||null))
    throw new Error("Mapping write not confirmed by read-back");
  return persisted;
}
