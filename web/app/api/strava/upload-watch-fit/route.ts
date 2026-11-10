import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {authEnabled,verifySession,SESSION_COOKIE} from "@/lib/auth";
import {getSessionEpoch} from "@/lib/session-epoch";
import {getDb} from "@/lib/db";
import {fetchAllWorkouts} from "@/lib/hevy-sync";
import {cachedHr,loadHrBackup,saveHrBackup,saveHrCache} from "@/lib/hr-store";
import {inspectManualWatchFit} from "@/lib/strava/manual-watch-fit";

export const runtime="nodejs";
export const dynamic="force-dynamic";
const MAX_BYTES=16*1024*1024;

export async function POST(request:Request){
  const url=new URL(request.url);
  const origin=request.headers.get("origin");
  if(!origin||origin!==url.origin)
    return NextResponse.json({error:"Origin mismatch"},{status:403});
  const sql=getDb();
  const epoch=await getSessionEpoch(sql);
  if(!authEnabled()||!await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});
  if(Number(request.headers.get("content-length")??"0")>MAX_BYTES+65536)
    return NextResponse.json({error:"Upload exceeds size limit"},{status:413});
  const body=await request.formData();
  const hevyId=String(body.get("hevyId")??"");
  if(!/^[a-zA-Z0-9-]{16,120}$/.test(hevyId))
    return NextResponse.json({error:"Invalid workout ID"},{status:400});
  const back=new URL("/strava/audit",url.origin);
  back.searchParams.set("hevyId",hevyId);
  const file=body.get("fit");
  if(!(file instanceof File)||!file.name.toLowerCase().endsWith(".fit")||
      file.size<14||file.size>MAX_BYTES){
    back.searchParams.set("manualFit","invalid");
    return NextResponse.redirect(back,303);
  }
  try{
    const rows=await sql`SELECT status,garmin_activity_id FROM synced_workouts
      WHERE hevy_id=${hevyId} LIMIT 1`;
    const sync=rows[0];
    if(sync?.status!=="success"||!sync.garmin_activity_id)
      throw new Error("Garmin synchronization missing");
    const garminId=String(sync.garmin_activity_id);
    const workouts=await fetchAllWorkouts();
    const workout=workouts.find(w=>w.id===hevyId);
    if(!workout?.start_time||!workout.end_time)
      throw new Error("Hevy workout times missing");
    const fit=inspectManualWatchFit(new Uint8Array(await file.arrayBuffer()),
      workout.start_time,workout.end_time);
    // Re-check binding before any writes. A FIT does not encode a reliable
    // Garmin Connect activity ID, so use Hevy start and the recorded sync ID.
    const latest=await sql`SELECT status,garmin_activity_id FROM synced_workouts
      WHERE hevy_id=${hevyId} LIMIT 1`;
    if(latest[0]?.status!=="success"||
       String(latest[0].garmin_activity_id)!==garminId)
      throw new Error("Workout association changed during inspection");
    const [cached,backup]=await Promise.all([
      cachedHr(sql,hevyId),
      loadHrBackup(sql,{id:hevyId,start_time:workout.start_time,end_time:workout.end_time})
    ]);
    if(fit.samples.length>(cached?.length??0))
      await saveHrCache(sql,hevyId,fit.samples);
    if(fit.samples.length>(backup?.length??0))
      await saveHrBackup(sql,{id:hevyId,start_time:workout.start_time,end_time:workout.end_time},
        fit.samples,garminId);
    // Preserve provenance of a MANUAL watch export; never claim it is the
    // consolidated final Garmin Connect FIT or overwrite that source record.
    const summary={
      source:"manual_watch_fit",hevyId,garminActivityId:garminId,
      sha256:fit.sha256,fitStartUtc:fit.fitStartUtc,
      samples:fit.samples.length,firstSampleUtc:fit.firstSampleUtc,
      lastSampleUtc:fit.lastSampleUtc,calories:fit.calories,
      receivedAt:new Date().toISOString()
    };
    await sql`INSERT INTO app_cache(key,value,updated_at)
      VALUES(${"manual_watch_fit_"+hevyId},${sql.json(summary)},NOW())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
    back.searchParams.set("manualFit",fit.samples.length?"ok":"no_hr");
  }catch(error){
    console.error("[manual-fit] rejected",hevyId,error instanceof Error?error.message:"unknown");
    back.searchParams.set("manualFit","rejected");
  }
  return NextResponse.redirect(back,303);
}
