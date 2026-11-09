import type { Sql } from "@/lib/pending-store";

/**
 * Strava upload ledger is independent from Garmin syncronisation.
 * Once reserved, a workout must be reconciled before ANY second submission:
 * a timed-out POST may have succeeded upstream, even without an upload_id.
 */
export type UploadState =
  "submitting" | "submitted" | "processing" | "ready" | "failed" | "unknown";
export interface StravaUploadRow {
  hevy_id:string;garmin_activity_id:string;external_id:string;
  payload_sha256:string;status:UploadState;upload_id:string|null;
  activity_id:string|null;last_error:string|null;
}
export async function getStravaUpload(sql:Sql,hevyId:string):Promise<StravaUploadRow|null>{
  const rows=await sql`SELECT hevy_id,garmin_activity_id,external_id,payload_sha256,
    status,upload_id,activity_id,last_error
    FROM strava_uploads WHERE hevy_id=${hevyId} LIMIT 1`;
  return rows[0] as unknown as StravaUploadRow|undefined ?? null;
}
export async function reserveStravaUpload(sql:Sql, input:{
  hevyId:string;garminActivityId:string;sha256:string;
}):Promise<boolean>{
  if(!input.hevyId || !input.garminActivityId ||
    !/^[0-9a-f]{64}$/i.test(input.sha256)) throw new Error("Invalid upload reservation");
  const externalId=`hevy2garmin-strava-${input.hevyId}-v1`;
  const rows=await sql`INSERT INTO strava_uploads
    (hevy_id,garmin_activity_id,external_id,payload_sha256,status,submitted_at)
    VALUES (${input.hevyId},${input.garminActivityId},${externalId},
      ${input.sha256},'submitting',NOW())
    ON CONFLICT DO NOTHING RETURNING hevy_id`;
  return rows.length===1;
}
export async function markStravaSubmitted(sql:Sql,hevyId:string,uploadId:string):Promise<boolean>{
  if (!/^\d+$/.test(uploadId)) throw new Error("Invalid upload ID");
  const rows=await sql`UPDATE strava_uploads SET status='submitted',upload_id=${uploadId},
      updated_at=NOW() WHERE hevy_id=${hevyId} AND status='submitting'
      AND upload_id IS NULL RETURNING hevy_id`;
  return rows.length===1;
}
export async function markStravaUnknown(sql:Sql,hevyId:string):Promise<void>{
  await sql`UPDATE strava_uploads SET status='unknown',last_error='Uncertain submission outcome; do not blindly retry',
    updated_at=NOW() WHERE hevy_id=${hevyId} AND status='submitting'`;
}
export async function recordStravaPoll(sql:Sql,hevyId:string, uploadId:string,
   input:{activityId?:string|null;error?:string|null;processing?:boolean}):Promise<void>{
  if (!/^\d+$/.test(uploadId)) throw new Error("Invalid upload ID");
  if (input.activityId && !/^\d+$/.test(input.activityId)) throw new Error("Invalid Strava activity ID");
  const state=input.activityId?"ready":input.error?"failed":"processing";
  await sql`UPDATE strava_uploads SET status=${state},activity_id=${input.activityId??null},
    last_error=${input.error??null},completed_at=CASE WHEN ${state}='ready' THEN NOW() ELSE completed_at END,
    updated_at=NOW() WHERE hevy_id=${hevyId} AND upload_id=${uploadId}
    AND status IN ('submitted','processing')`;
}
