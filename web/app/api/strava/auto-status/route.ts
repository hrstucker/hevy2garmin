import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {authEnabled,verifySession,SESSION_COOKIE} from "@/lib/auth";
import {getSessionEpoch} from "@/lib/session-epoch";
import {getDb} from "@/lib/db";
import {autoStravaConfig} from "@/lib/strava/auto-policy";
export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Authenticated, strictly read-only rollout diagnostics. Never submits. */
export async function GET(){
  try{
    const sql=getDb();
    const epoch=await getSessionEpoch(sql);
    if(!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
      return NextResponse.json({error:"Unauthorized"},{status:401});
    const policy=autoStravaConfig(process.env);
    const rows=await sql`SELECT
      (SELECT COUNT(*)::integer FROM strava_uploads WHERE status='ready') AS ready,
      (SELECT COUNT(*)::integer FROM strava_uploads WHERE status IN ('submitting','unknown')) AS needs_reconciliation,
      (SELECT COUNT(*)::integer FROM strava_uploads WHERE status IN ('submitted','processing')) AS processing`;
    const counts=rows[0]??{};
    return NextResponse.json({
      enabled:policy.enabled,
      activationCutoffUtc:policy.cutoff,
      configurationError:policy.error,
      schedule:"0 11 * * * UTC",
      note:"This endpoint is read-only; configured Vercel crons execute in production only",
      uploads:{
        ready:Number(counts.ready??0),
        needsManualReconciliation:Number(counts.needs_reconciliation??0),
        processing:Number(counts.processing??0),
      }
    },{headers:{"Cache-Control":"no-store"}});
  }catch{
    return NextResponse.json({error:"Cannot read auto-sync configuration/state"},{status:503});
  }
}
