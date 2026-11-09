/**
 * Unattended, opt-in reconciliation of completed Garmin syncs to Strava.
 * NEVER calls Garmin upload/merge or alters existing Strava activities.
 * Each tick polls one submitted job or submits at most one eligible new workout.
 * Any uncertainty is fail-closed and must be manually reconciled.
 */
import {createHash} from "node:crypto";
import {getDb} from "@/lib/db";
import {fetchAllWorkouts, type HevyWorkout} from "@/lib/hevy-sync";
import {getStravaAccessToken} from "./authenticated-client";
import {listStravaActivities,findPossibleStrengthDuplicates} from "./activity-client";
import {getUploadStatus,submitStrengthJson} from "./json-upload";
import {getStravaUpload,markStravaSubmitted,markStravaUnknown,recordStravaPoll,reserveStravaUpload} from "./upload-ledger";
import {prepareConsolidatedExport} from "./prepare-export";
import {autoStravaConfig,eligibleAutoStravaWorkout} from "./auto-policy";

type Sql=ReturnType<typeof getDb>;
export type AutoReconcileResult={
  mode:"disabled"|"error"|"idle"|"blocked"|"submitted"|"polled";
  hevyId?:string;status?:string;reason?:string;uploadId?:string;activityId?:string;
};

export async function autoReconcileStrava(sql:Sql=getDb()):Promise<AutoReconcileResult>{
  const policy=autoStravaConfig(process.env);
  if(policy.error)return {mode:"error",reason:policy.error};
  if(!policy.enabled || !policy.cutoff)return {mode:"disabled"};
  const cutoff=policy.cutoff;

  // Previous asynchronous uploads get first priority. No second POST is made
  // for the same workout even if processing stalls indefinitely.
  const pending=await sql`SELECT hevy_id,upload_id FROM strava_uploads
    WHERE status IN ('submitted','processing') AND upload_id IS NOT NULL
    ORDER BY submitted_at ASC LIMIT 1`;
  if(pending.length){
    const hevyId=String(pending[0].hevy_id);
    const uploadId=String(pending[0].upload_id);
    const token=await getStravaAccessToken();
    const result=await getUploadStatus(token,uploadId);
    await recordStravaPoll(sql,hevyId,uploadId,{
      activityId:result.activity_id,error:result.error
    });
    return {mode:"polled",hevyId,uploadId,
      status:result.activity_id?"ready":result.error?"failed":"processing",
      activityId:result.activity_id??undefined};
  }

  // Use sync-completion records rather than Hevy completion as the source
  // of truth. Never auto-import older Hevy or older Garmin history.
  const rows=await sql`SELECT s.hevy_id,s.synced_at FROM synced_workouts s
    WHERE s.status='success' AND s.garmin_activity_id IS NOT NULL
      AND s.synced_at >= ${cutoff}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM strava_uploads u WHERE u.hevy_id=s.hevy_id)
    ORDER BY s.synced_at ASC LIMIT 30`;
  if(!rows.length)return {mode:"idle"};

  const nowMs=Date.now();
  // Batch fetch only once, then verify the exact corresponding workout.
  const workouts=await fetchAllWorkouts();
  const byId=new Map((workouts as HevyWorkout[]).map(w=>[w.id,w]));
  for(const row of rows){
    const hevyId=String(row.hevy_id);
    const w=byId.get(hevyId);
    const syncedAt=row.synced_at instanceof Date?row.synced_at.toISOString():String(row.synced_at??"");
    if(!w || !eligibleAutoStravaWorkout({
      startTime:w.start_time??"",syncedAt,cutoff,nowMs
    }))continue;

    // Historical first upload and any uncertain attempts are protected
    // by the ledger check/atomic reserve. No blind retry.
    const known=await getStravaUpload(sql,hevyId);
    if(known)continue;

    let prepared;
    try{
      prepared=await prepareConsolidatedExport(sql,hevyId,-10800,
        {recoverMissingHrFromGarmin:true});
    }catch(e){
      console.error("[strava-auto] preparation failed for",hevyId,e instanceof Error?e.message:"unknown");
      continue;
    }
    if(!prepared.ready || !prepared.payload)continue;

    const token=await getStravaAccessToken();
    const started=Math.floor(Date.parse(prepared.payload.start_time)/1000);
    // Read-only duplicate lookup. API errors abort instead of posting.
    const nearby=await listStravaActivities({
      accessToken:token,after:started-601,before:started+601
    });
    const possible=findPossibleStrengthDuplicates(nearby,prepared.payload.start_time);
    if(possible.length){
      // Do not continuously retry possible duplicate on every cron. Instead
      // leave untouched and report for manual review; no ledger entry taken.
      return {mode:"blocked",hevyId,
        reason:"Possible existing Strava strength activity in the same start window"};
    }
    const data=JSON.stringify(prepared.payload);
    const sha256=createHash("sha256").update(data).digest("hex");
    const reserved=await reserveStravaUpload(sql,{
      hevyId,garminActivityId:prepared.garminActivityId,sha256
    });
    if(!reserved)continue;

    try{
      const receipt=await submitStrengthJson({
        accessToken:token,hevyWorkoutId:hevyId,workout:prepared.payload,
        name:prepared.name,
        description:"Treino Hevy com séries, cargas e frequência cardíaca Garmin. Consolidado por Hevy2Garmin.",
      });
      const updated=await markStravaSubmitted(sql,hevyId,receipt.id);
      if(!updated)return {mode:"blocked",hevyId,
        reason:"Strava accepted upload but state could not be recorded; manual reconciliation required"};
      return {mode:"submitted",hevyId,uploadId:receipt.id,status:receipt.status};
    }catch(_e){
      await markStravaUnknown(sql,hevyId).catch(()=>{});
      console.error("[strava-auto] uncertain submission; manual reconciliation required",hevyId);
      return {mode:"blocked",hevyId,
        reason:"Submission outcome unknown; automatic retry forbidden"};
    }
  }
  return {mode:"idle"};
}
