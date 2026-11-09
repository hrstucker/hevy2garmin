import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSessionEpoch } from "@/lib/session-epoch";
import { getDb } from "@/lib/db";
import { fetchAllWorkouts, type HevyWorkout } from "@/lib/hevy-sync";
import { cachedHr, loadHrBackup } from "@/lib/hr-store";
import { buildStrengthJson, type SourceExercise } from "@/lib/strava/strength-json";
import { loadStravaMappings } from "@/lib/strava/mapping-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function exerciseData(workout: HevyWorkout): SourceExercise[] {
  if (!Array.isArray(workout.exercises)) throw new Error("Hevy exercise list unavailable");
  return workout.exercises.map(raw => {
    const e = raw && typeof raw==="object" ? raw as Record<string,unknown> : {};
    if (typeof e.title !== "string" || !Array.isArray(e.sets))
      throw new Error("Incomplete Hevy exercise details");
    return { title:e.title, sets:e.sets.map(rawSet => {
      const set=rawSet && typeof rawSet==="object" ? rawSet as Record<string,unknown> : {};
      const weight=set.weight_kg, reps=set.reps, duration=set.duration_seconds;
      if (weight != null && typeof weight!=="number") throw new Error("Hevy weight is not numeric");
      if (reps != null && typeof reps!=="number") throw new Error("Hevy reps are not numeric");
      if (duration != null && typeof duration!=="number") throw new Error("Hevy duration is not numeric");
      return {
        weight_kg:weight as number|null|undefined,
        reps:reps as number|null|undefined,
        duration_seconds:duration as number|null|undefined,
        type:typeof set.type==="string"?set.type:null,
        // No start_time is synthesized: Hevy lacks set-level start timestamps.
      };
    })};
  });
}

export async function GET(request:Request) {
  let sql:ReturnType<typeof getDb>;
  try {sql=getDb();} catch {return NextResponse.json({error:"Database unavailable"},{status:503});}
  const jar=await cookies();
  const epoch=await getSessionEpoch(sql);
  if (!authEnabled() || !await verifySession(jar.get(SESSION_COOKIE)?.value??null,epoch)) {
    return NextResponse.json({error:"Unauthorized"},{status:401});
  }
  const url=new URL(request.url);
  const hevyId=url.searchParams.get("hevyId")??"";
  const offsetRaw=url.searchParams.get("utcOffsetSeconds");
  const offset=offsetRaw===null?NaN:Number(offsetRaw);
  if (!hevyId || hevyId.length>120 || !Number.isInteger(offset) || Math.abs(offset)>50400 || offset%60!==0)
    return NextResponse.json({error:"Valid hevyId and explicit UTC offset required"},{status:400});
  try {
    const rows=await sql`SELECT hevy_id,status,garmin_activity_id,calories,title FROM synced_workouts
      WHERE hevy_id=${hevyId} LIMIT 1`;
    const linked=rows[0];
    if (!linked || linked.status!=="success" || !linked.garmin_activity_id)
      return NextResponse.json({error:"Garmin Merge not confirmed for workout"},{status:409});
    const workouts=await fetchAllWorkouts();
    const workout=workouts.find((w:HevyWorkout)=>w.id===hevyId);
    if (!workout) return NextResponse.json({error:"Hevy workout unavailable"},{status:404});
    const exercises=exerciseData(workout);
    const mappings=await loadStravaMappings(sql);
    const unmapped=[...new Set(exercises.map(e=>e.title).filter(t=>!mappings[t]))];
    const samples=await cachedHr(sql,hevyId) ??
      await loadHrBackup(sql,{id:hevyId,start_time:workout.start_time,end_time:workout.end_time});
    const diagnostics={
      mode:"read_only", changes_made:false,hevyId,garminActivityId:String(linked.garmin_activity_id),
      name:workout.title??linked.title??"Treino",sets:exercises.reduce((n,e)=>n+e.sets.length,0),
      exercises:exercises.map(e=>({title:e.title,sets:e.sets.length,
        mappedTo:mappings[e.title]??null})),
      unmappedExercises:unmapped,hrSamples:samples?.length??0,
      source:"Hevy workouts + saved Garmin HR cache/backup + Garmin sync ledger",
      timezoneOffsetSeconds:offset,
      warning:"A timezone offset was supplied explicitly for this preview and must match the workout location.",
    };
    if (unmapped.length || !samples?.length)
      return NextResponse.json({...diagnostics,ready:false,
        reasons:[...(unmapped.length?["Missing reviewed exercise mappings"]:[]),
          ...(!samples?.length?["Timestamped Garmin HR not available"]:[])]},
        {status:422,headers:{"Cache-Control":"no-store"}});
    const payload=buildStrengthJson({
      startTime:workout.start_time??"",
      endTime:workout.end_time??"",
      utcOffsetSeconds:offset,
      exercises,exerciseTypes:mappings,
      hrSamples:samples,
      calories:typeof linked.calories==="number"?linked.calories:null,
    });
    if (url.searchParams.get("download")==="1") {
      return new Response(JSON.stringify(payload,null,2),{
        headers:{"Content-Type":"application/json; charset=utf-8",
          "Content-Disposition":`attachment; filename="hevy2garmin-${hevyId.replace(/[^a-zA-Z0-9_-]/g,"_")}.json"`,
          "Cache-Control":"no-store"},
      });
    }
    return NextResponse.json({...diagnostics,ready:true,payload},
      {headers:{"Cache-Control":"no-store"}});
  }catch(e){
    return NextResponse.json({ready:false,error:e instanceof Error?e.message:"Cannot create preview",
      changes_made:false},{status:422,headers:{"Cache-Control":"no-store"}});
  }
}
