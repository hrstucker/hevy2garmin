import {NextResponse} from "next/server";
import {getDb} from "@/lib/db";
import {autoReconcileStrava} from "@/lib/strava/auto-reconcile";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/**
 * Independent post-Garmin reconciliation, suitable for a daily Vercel Cron.
 * Authorization: CRON_SECRET only. No anonymous or session-based GET writes.
 * Disabled by default. Never calls Garmin merge.
 */
export async function GET(request:Request){
  const secret=process.env.CRON_SECRET;
  const authorization=request.headers.get("authorization")??"";
  if(!secret || authorization!==`Bearer ${secret}`)
    return NextResponse.json({error:"Unauthorized"},{status:401});
  if(process.env.STRAVA_AUTO_SYNC_ENABLED!=="true")
    return NextResponse.json({mode:"disabled"},{headers:{"Cache-Control":"no-store"}});
  try{
    const result=await autoReconcileStrava(getDb());
    const code=result.mode==="error"?503:200;
    return NextResponse.json(result,{status:code,headers:{"Cache-Control":"no-store"}});
  }catch(e){
    console.error("[strava-auto] reconciliation failed",e instanceof Error?e.message:"unknown");
    return NextResponse.json({mode:"error",reason:"Reconciliation failed; no automatic retry of ambiguous uploads"},{status:503,
      headers:{"Cache-Control":"no-store"}});
  }
}
