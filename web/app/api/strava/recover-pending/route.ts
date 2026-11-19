import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {authEnabled,verifySession,SESSION_COOKIE} from "@/lib/auth";
import {getSessionEpoch} from "@/lib/session-epoch";
import {getDb} from "@/lib/db";
import {autoReconcileStrava} from "@/lib/strava/auto-reconcile";

export const runtime="nodejs";
export const dynamic="force-dynamic";

/** Explicit per-workout recovery. Same policy, ledger and duplicate preflight as the daily cron. */
export async function POST(request:Request) {
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"Cross-origin request"},{status:403});
  const sql=getDb();
  const epoch=await getSessionEpoch(sql);
  if(!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});
  let input:unknown;
  try{input=await request.json();}catch{return NextResponse.json({error:"Invalid JSON"},{status:400});}
  const body=input&&typeof input==="object"?input as Record<string,unknown>:{};
  const hevyId=body.hevyId;
  if(typeof hevyId!=="string" || !/^[a-zA-Z0-9-]{1,120}$/.test(hevyId) ||
      body.confirm!==true)
    return NextResponse.json({error:"Explicit confirmation and valid workout ID required"},{status:400});
  try{
    const result=await autoReconcileStrava(sql,hevyId);
    return NextResponse.json(result,{status:result.mode==="error"?503:200,headers:{"Cache-Control":"no-store"}});
  }catch(e){
    console.error("[strava-recover] failed",e instanceof Error?e.message:"unknown");
    return NextResponse.json({mode:"error",reason:"Recovery failed. Do not retry until the upload ledger is checked."},{status:503});
  }
}
