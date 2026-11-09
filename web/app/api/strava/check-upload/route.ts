import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSessionEpoch } from "@/lib/session-epoch";
import { getDb } from "@/lib/db";
import { getStravaAccessToken } from "@/lib/strava/authenticated-client";
import { getUploadStatus } from "@/lib/strava/json-upload";
import { getStravaUpload, recordStravaPoll } from "@/lib/strava/upload-ledger";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Explicit status reconciliation; never submits or deletes activities. */
export async function POST(request:Request) {
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"Cross-origin request"},{status:403});
  const sql=getDb();
  const epoch=await getSessionEpoch(sql);
  if(!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});
  let body:unknown;
  try{body=await request.json();}catch{return NextResponse.json({error:"Invalid JSON"},{status:400});}
  const hevyId=typeof body==="object" && body!==null &&
    "hevyId" in body ? (body as {hevyId:unknown}).hevyId:null;
  if(typeof hevyId!=="string" || !hevyId || hevyId.length>120)
    return NextResponse.json({error:"Invalid Hevy ID"},{status:400});
  const row=await getStravaUpload(sql,hevyId);
  if(!row) return NextResponse.json({error:"No upload recorded"},{status:404});
  if(!row.upload_id || !["submitted","processing"].includes(row.status)) {
    return NextResponse.json({status:row.status,activityId:row.activity_id,
      error:row.last_error,requiresManualReconciliation:row.status==="unknown"});
  }
  try {
    const token=await getStravaAccessToken();
    const status=await getUploadStatus(token,row.upload_id);
    await recordStravaPoll(sql,hevyId,row.upload_id,{
      activityId:status.activity_id,error:status.error,
    });
    return NextResponse.json({
      status:status.activity_id?"ready":status.error?"failed":"processing",
      stravaActivityId:status.activity_id,error:status.error,
      detail:status.status,
    },{headers:{"Cache-Control":"no-store"}});
  }catch {
    return NextResponse.json({error:"Upload status could not be verified; do not retry submission"},{status:502});
  }
}
