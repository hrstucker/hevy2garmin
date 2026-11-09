import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHash } from "node:crypto";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSessionEpoch } from "@/lib/session-epoch";
import { getDb } from "@/lib/db";
import { prepareConsolidatedExport } from "@/lib/strava/prepare-export";
import { getStravaAccessToken } from "@/lib/strava/authenticated-client";
import { submitStrengthJson } from "@/lib/strava/json-upload";
import { getStravaUpload, reserveStravaUpload, markStravaSubmitted, markStravaUnknown } from "@/lib/strava/upload-ledger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Feature-flagged, explicitly confirmed one-workout upload.
 * Disabled unless STRAVA_UPLOADS_ENABLED=true and STRAVA_FIRST_UPLOAD_UTC
 * are configured. NEVER changes or resynchronizes Garmin.
 */
export async function POST(request:Request) {
  if(process.env.STRAVA_UPLOADS_ENABLED!=="true")
    return NextResponse.json({error:"Strava upload disabled"},{status:403});
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"Cross-origin request rejected"},{status:403});
  // First-live-upload defense in depth: a deployment flag cannot enable every workout.
  const allowedHevyId=process.env.STRAVA_ALLOWED_HEVY_ID;
  if(!allowedHevyId || allowedHevyId.length>120)
    return NextResponse.json({error:"Exact first-upload Hevy ID not configured"},{status:503});
  const earliest=process.env.STRAVA_FIRST_UPLOAD_UTC;
  if(!earliest || !Number.isFinite(Date.parse(earliest)))
    return NextResponse.json({error:"Upload cutoff not configured"},{status:503});
  const sql=getDb();
  const epoch=await getSessionEpoch(sql);
  if(!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});
  let body:unknown;
  try {body=await request.json();}catch{return NextResponse.json({error:"Invalid JSON"},{status:400});}
  if(!body || typeof body!=="object" || Array.isArray(body))
    return NextResponse.json({error:"Invalid body"},{status:400});
  const input=body as Record<string,unknown>;
  const hevyId=input.hevyId;
  const offset=input.utcOffsetSeconds;
  if(typeof hevyId!=="string" || hevyId.length>120 || !hevyId ||
    typeof offset!=="number" || !Number.isInteger(offset) ||
    input.confirmation!==`UPLOAD:${hevyId}` ||
    typeof input.expectedSha256!=="string" || !/^[a-f0-9]{64}$/.test(input.expectedSha256))
    return NextResponse.json({error:"Explicit identity, UTC offset, fingerprint and confirmation required"},{status:400});
  if(hevyId!==allowedHevyId)
    return NextResponse.json({error:"This workout is not authorized for the first upload"},{status:403});
  try {
    const existing=await getStravaUpload(sql,hevyId);
    if(existing) return NextResponse.json({
      error:"Already reserved or uploaded; automatic retry is forbidden",
      status:existing.status,activityId:existing.activity_id,uploadId:existing.upload_id,
    },{status:409});
    const prepared=await prepareConsolidatedExport(sql,hevyId,offset);
    if(!prepared.ready || !prepared.payload)
      return NextResponse.json({error:"Consolidated workout is not ready",reasons:prepared.reasons},{status:422});
    if(Date.parse(prepared.payload.start_time)<Date.parse(earliest))
      return NextResponse.json({error:"Workout is older than the explicit first-upload cutoff"},{status:409});
    const data=JSON.stringify(prepared.payload);
    const sha256=createHash("sha256").update(data).digest("hex");
    if(sha256!==input.expectedSha256)
      return NextResponse.json({error:"Preview fingerprint changed; download and confirm again"},{status:409});
    // Authenticate to Strava before taking the durable submission lock.
    const token=await getStravaAccessToken();
    const reserved=await reserveStravaUpload(sql,{
      hevyId,garminActivityId:prepared.garminActivityId,sha256,
    });
    if(!reserved) return NextResponse.json({error:"Duplicate upload reservation"},{status:409});
    try {
      const receipt=await submitStrengthJson({
        accessToken:token,hevyWorkoutId:hevyId,workout:prepared.payload,
        name:prepared.name,
        description:"Treino consolidado do Hevy com frequência cardíaca Garmin. Enviado por Hevy2Garmin.",
      });
      const updated=await markStravaSubmitted(sql,hevyId,receipt.id);
      if(!updated)
        return NextResponse.json({error:"Upload accepted but ledger needs manual reconciliation"},{status:503});
      return NextResponse.json({submitted:true,uploadId:receipt.id,status:receipt.status},{status:202});
    }catch {
      await markStravaUnknown(sql,hevyId).catch(()=>{});
      return NextResponse.json({
        error:"Submission outcome uncertain; do NOT retry automatically. Reconcile with Strava first.",
      },{status:503});
    }
  }catch {
    return NextResponse.json({error:"Could not prepare or reserve upload"},{status:503});
  }
}
