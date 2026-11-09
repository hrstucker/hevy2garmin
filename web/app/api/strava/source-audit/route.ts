import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSessionEpoch } from "@/lib/session-epoch";
import { getDb } from "@/lib/db";
import { fetchAllWorkouts, type HevyWorkout } from "@/lib/hevy-sync";
import { cachedHr, loadHrBackup } from "@/lib/hr-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only source audit. Never uploads, merges or modifies a workout.
 * Reveals field availability, not private credentials or raw HR streams.
 */
export async function GET(request: Request) {
  const sql = getDb();
  const epoch = await getSessionEpoch(sql);
  const jar = await cookies();
  if (!authEnabled() || !await verifySession(jar.get(SESSION_COOKIE)?.value ?? null, epoch)) {
    return NextResponse.json({error:"Unauthorized"},{status:401});
  }
  const hevyId = new URL(request.url).searchParams.get("hevyId") ?? "";
  if (!hevyId || hevyId.length > 120) return NextResponse.json({error:"hevyId required"},{status:400});
  try {
    const records = await sql`SELECT hevy_id,garmin_activity_id,status,title,calories
      FROM synced_workouts WHERE hevy_id=${hevyId} LIMIT 1`;
    const row = records[0];
    if (!row || row.status !== "success" || !row.garmin_activity_id) {
      return NextResponse.json({error:"Not a completed Garmin sync"},{status:409});
    }
    const workouts = await fetchAllWorkouts();
    const workout = workouts.find((w:HevyWorkout)=>w.id===hevyId);
    if (!workout) return NextResponse.json({error:"Workout unavailable from Hevy"},{status:404});
    const rawExercises = Array.isArray(workout.exercises) ? workout.exercises : [];
    const exercises = rawExercises.map(raw=>{
      const x = raw && typeof raw==="object" ? raw as Record<string,unknown> : {};
      const sets=Array.isArray(x.sets)?x.sets:[];
      return {title:typeof x.title==="string"?x.title:"(missing title)",sets:sets.length,
        availableFields: [...new Set(sets.flatMap(item=>
          item && typeof item==="object" ? Object.keys(item as Record<string,unknown>) : []))].sort()};
    });
    const samples = await cachedHr(sql,hevyId) ??
      await loadHrBackup(sql,{id:hevyId,start_time:workout.start_time,end_time:workout.end_time});
    const report = {
      mode:"read_only", changes_made:false,
      hevy_id:hevyId, garmin_activity_id:String(row.garmin_activity_id),
      title:typeof workout.title==="string"?workout.title:String(row.title ?? ""),
      start_time:workout.start_time??null,end_time:workout.end_time??null,
      source_fields:Object.keys(workout).sort(),
      exercises, hr_sample_count:samples?.length??0,
      hr_source:samples?.length?"hr_cache_or_backup":"unavailable",
      calories_garmin:typeof row.calories==="number"?row.calories:null,
      ready_for_upload:false,
      note:"Source audit only: exercise-to-Strava mapping and data verification pending.",
    };
    return NextResponse.json(report,{headers:{"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"Source inspection unavailable"},{status:503});
  }
}
