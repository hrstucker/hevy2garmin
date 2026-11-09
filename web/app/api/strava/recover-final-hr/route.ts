import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {authEnabled,verifySession,SESSION_COOKIE} from "@/lib/auth";
import {getSessionEpoch} from "@/lib/session-epoch";
import {getDb} from "@/lib/db";
import {fetchAllWorkouts} from "@/lib/hevy-sync";
import {recoverAndCacheFinalGarminHr} from "@/lib/strava/garmin-final-recovery";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** An explicitly requested, same-origin cache refresh. Garmin is READ ONLY. */
export async function POST(request:Request){
  const url=new URL(request.url);
  const origin=request.headers.get("origin");
  // Reject cross-site form posts even if session cookie policy changes.
  if(!origin || origin!==url.origin)
    return NextResponse.json({error:"Origin mismatch"},{status:403});
  const sql=getDb();
  const epoch=await getSessionEpoch(sql);
  if(!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});

  const body=await request.formData();
  const hevyId=String(body.get("hevyId")??"");
  if(!/^[a-zA-Z0-9-]{16,120}$/.test(hevyId))
    return NextResponse.json({error:"Invalid Hevy workout ID"},{status:400});
  const back=new URL("/strava/preview",url.origin);
  back.searchParams.set("hevyId",hevyId);
  back.searchParams.set("utcOffsetSeconds","-10800");
  try{
    const records=await sql`SELECT garmin_activity_id,status FROM synced_workouts
      WHERE hevy_id=${hevyId} LIMIT 1`;
    const sync=records[0];
    if(!sync || sync.status!=="success" || !sync.garmin_activity_id)
      throw new Error("No completed Garmin activity");
    const workouts=await fetchAllWorkouts();
    const workout=workouts.find(w=>w.id===hevyId);
    if(!workout)throw new Error("Hevy workout not available");
    const recovered=await recoverAndCacheFinalGarminHr(sql,{
      hevyId,garminActivityId:String(sync.garmin_activity_id),workout
    });
    console.info("[strava-recovery] cached final Garmin FIT HR",hevyId,recovered.samples);
    back.searchParams.set("recovery","ok");
  }catch(e){
    console.error("[strava-recovery] failed",hevyId,e instanceof Error?e.message:"unknown");
    back.searchParams.set("recovery","failed");
  }
  return NextResponse.redirect(back,303);
}
