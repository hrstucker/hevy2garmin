import {createHash} from "node:crypto";
import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {authEnabled,verifySession,SESSION_COOKIE} from "@/lib/auth";
import {getSessionEpoch} from "@/lib/session-epoch";
import {getDb} from "@/lib/db";
import {fetchAllWorkouts} from "@/lib/hevy-sync";
import {getStravaAccessToken} from "@/lib/strava/authenticated-client";
import {findPossibleStrengthDuplicates,listStravaActivities} from "@/lib/strava/activity-client";
import {prepareConsolidatedExport} from "@/lib/strava/prepare-export";
import {getStravaUpload,markStravaSubmitted,markStravaUnknown,reserveStravaUpload} from "@/lib/strava/upload-ledger";
import {submitStrengthJson} from "@/lib/strava/json-upload";
import {historicalWorkoutEligible,historicalUploadConfirmation} from "@/lib/strava/historical-policy";

export const runtime="nodejs";
export const dynamic="force-dynamic";

async function inspect(sql:ReturnType<typeof getDb>,hevyId:string){
  const existing=await getStravaUpload(sql,hevyId);
  if(existing)return {ready:false,code:"ledger",error:"Existing Strava upload/reservation; manual reconciliation required",
    status:existing.status,activityId:existing.activity_id};
  const workouts=await fetchAllWorkouts();
  const workout=workouts.find(w=>w.id===hevyId);
  if(!workout?.start_time || !historicalWorkoutEligible(workout.start_time))
    return {ready:false,code:"cutoff",error:"This is not a historical workout"};
  // Audit may recover HR or confirm its genuine absence from the final Garmin FIT.
  // A missing local cache alone is not proof that no watch was worn.
  let prepared;
  try{
    prepared=await prepareConsolidatedExport(sql,hevyId,-10800,{recoverMissingHrFromGarmin:true});
  }catch(error){
    return {ready:false,code:"verification_pending",
      error:"Não foi possível verificar o FIT final no Garmin. O treino não foi descartado.",
      reasons:[error instanceof Error?error.message:"Falha na verificação da fonte Garmin"]};
  }
  if(!prepared.ready||!prepared.payload)return {ready:false,
    code:prepared.reasons.some(reason=>reason.includes("heart-rate source not yet verified"))?"verification_pending":"sources",
    error:"Treino aguardando correção ou validação de fontes",reasons:prepared.reasons};
  const token=await getStravaAccessToken();
  const epoch=Math.floor(Date.parse(prepared.payload.start_time)/1000);
  if(!Number.isFinite(epoch))throw new Error("Invalid workout timestamp");
  const nearby=await listStravaActivities({accessToken:token,after:epoch-601,before:epoch+601});
  const possible=findPossibleStrengthDuplicates(nearby,prepared.payload.start_time);
  if(possible.length)return {ready:false,code:"possible_duplicate",
    error:"Possible existing Strava activity in the same time window",
    possibleActivityIds:possible.map(a=>String(a.id))};
  return {ready:true,code:"ready",name:prepared.name,hevyId,
    startTime:prepared.payload.start_time,sets:prepared.payload.sets.length,
    hrSamples:prepared.hrSamples,hrVerifiedAbsent:prepared.hrVerifiedAbsent,
    hrSource:prepared.hrSource,garminActivityId:prepared.garminActivityId,
    fingerprint:createHash("sha256").update(JSON.stringify(prepared.payload)).digest("hex"),
    prepared,token};
}

/** No background import: audit returns an approval fingerprint; submit uses
 * a second explicit request and rechecks sources and duplicates.
 */
export async function POST(request:Request){
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"Cross-origin request rejected"},{status:403});
  const sql=getDb();
  const epoch=await getSessionEpoch(sql);
  if(!authEnabled()||!await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});
  let raw:unknown;
  try{raw=await request.json();}catch{return NextResponse.json({error:"Invalid request"},{status:400});}
  const data=raw&&typeof raw==="object"&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
  const hevyId=data.hevyId,action=data.action;
  if(typeof hevyId!=="string"||!/^[a-zA-Z0-9-]{16,120}$/.test(hevyId)||
     !["audit","submit"].includes(String(action)))
    return NextResponse.json({error:"Invalid workout or action"},{status:400});
  if(action==="submit"){
    if(process.env.STRAVA_HISTORICAL_UPLOADS_ENABLED!=="true")
      return NextResponse.json({error:"Historical uploads are disabled by configuration"},{status:403});
    if(data.confirmation!==historicalUploadConfirmation(hevyId)||
       typeof data.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(data.fingerprint))
      return NextResponse.json({error:"Explicit historical confirmation and valid audit fingerprint required"},{status:400});
  }
  try{
    const result=await inspect(sql,hevyId);
    if(!result.ready)return NextResponse.json(result,{status:409,headers:{"Cache-Control":"no-store"}});
    if(action==="audit"){
      const {prepared:_prepared,token:_token,...report}=result;
      return NextResponse.json(report,{headers:{"Cache-Control":"no-store"}});
    }
    if(result.fingerprint!==data.fingerprint)
      return NextResponse.json({error:"Sources changed since the audit; audit again"},{status:409});
    // Do not overlap an old-history submission with a still-unknown or pending job.
    const pending=await sql`SELECT hevy_id FROM strava_uploads
      WHERE status IN ('submitting','submitted','processing','unknown')
      LIMIT 1`;
    if(pending.length)return NextResponse.json({error:"A prior upload requires reconciliation first"},{status:409});
    const reserved=await reserveStravaUpload(sql,{
      hevyId,garminActivityId:result.garminActivityId!,sha256:result.fingerprint!
    });
    if(!reserved)return NextResponse.json({error:"Already reserved; cannot retry"},{status:409});
    try{
      const receipt=await submitStrengthJson({
        accessToken:result.token!,hevyWorkoutId:hevyId,workout:result.prepared!.payload!,
        name:result.name!,
        description:"Treino histórico Hevy + Garmin, importado individualmente após auditoria. Hevy2Garmin."
      });
      const updated=await markStravaSubmitted(sql,hevyId,receipt.id);
      if(!updated)return NextResponse.json({error:"Strava accepted upload, but ledger update needs manual reconciliation"},{status:503});
      return NextResponse.json({submitted:true,uploadId:receipt.id,status:receipt.status},{status:202});
    }catch{
      await markStravaUnknown(sql,hevyId).catch(()=>{});
      return NextResponse.json({error:"Submission outcome uncertain. Reconcile on Strava; never retry automatically"},{status:503});
    }
  }catch(error){
    console.error("[strava-historical] inspection failed",hevyId,error instanceof Error?error.message:"unknown");
    return NextResponse.json({error:"Could not verify historical sources and Strava duplicates"},{status:503});
  }
}
