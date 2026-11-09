/**
 * Safe enrichment path for a previously completed Garmin sync.
 * Reads only the Garmin activity recorded in synced_workouts and writes only
 * local HR source caches. Never uploads, renames or changes Garmin/Strava.
 */
import type {getDb} from "@/lib/db";
import type {HevyWorkout} from "@/lib/hevy-sync";
import {cachedHr,loadHrBackup,saveHrBackup,saveHrCache} from "@/lib/hr-store";
import {fetchGarminFinalFit} from "./garmin-final-fit";

type Sql=ReturnType<typeof getDb>;
export type RecoveryResult={
  samples:number;garminActivityId:string;calories:number|null;
  source:"garmin_final_fit";firstSampleUtc:string;lastSampleUtc:string;
};

export async function recoverAndCacheFinalGarminHr(sql:Sql,input:{
  hevyId:string;garminActivityId:string;workout:HevyWorkout;
}):Promise<RecoveryResult>{
  const {hevyId,garminActivityId,workout}=input;
  if(workout.id!==hevyId || !workout.start_time || !workout.end_time)
    throw new Error("Hevy workout identity/timestamps mismatch");
  const current=await sql`SELECT garmin_activity_id,status FROM synced_workouts
    WHERE hevy_id=${hevyId} LIMIT 1`;
  if(current[0]?.status!=="success" ||
    String(current[0].garmin_activity_id)!==garminActivityId)
    throw new Error("Recorded Garmin activity differs; recovery forbidden");

  const recovered=await fetchGarminFinalFit(garminActivityId,workout.start_time,workout.end_time);
  // Never overwrite a denser preserved HR timeline with a coarser extraction.
  const [cache,backup]=await Promise.all([
    cachedHr(sql,hevyId),
    loadHrBackup(sql,{id:hevyId,start_time:workout.start_time,end_time:workout.end_time})
  ]);
  if(recovered.samples.length>(cache?.length??0)){
    await saveHrCache(sql,hevyId,recovered.samples);
  }
  if(recovered.samples.length>(backup?.length??0)){
    await saveHrBackup(sql,{id:hevyId,start_time:workout.start_time,end_time:workout.end_time},
      recovered.samples,garminActivityId);
  }
  const summary:RecoveryResult={
    samples:recovered.samples.length,garminActivityId,
    calories:recovered.calories,source:"garmin_final_fit",
    firstSampleUtc:recovered.firstSampleUtc,lastSampleUtc:recovered.lastSampleUtc
  };
  // Verified final FIT values stay separate from estimated original sync stats.
  await sql`INSERT INTO app_cache (key,value,updated_at)
    VALUES (${"garmin_final_fit_"+hevyId},${sql.json(summary)},NOW())
    ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=NOW()`;
  return summary;
}
