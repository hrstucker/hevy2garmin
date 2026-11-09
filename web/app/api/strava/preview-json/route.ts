import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSessionEpoch } from "@/lib/session-epoch";
import { getDb } from "@/lib/db";
import { prepareConsolidatedExport } from "@/lib/strava/prepare-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only inspects and optionally downloads a locally prepared file. No Strava writes. */
export async function GET(request:Request) {
  let sql:ReturnType<typeof getDb>;
  try { sql=getDb(); }catch {
    return NextResponse.json({error:"Database unavailable"},{status:503});
  }
  try {
    const epoch=await getSessionEpoch(sql);
    if(!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
      return NextResponse.json({error:"Unauthorized"},{status:401});

    const url=new URL(request.url);
    const hevyId=url.searchParams.get("hevyId")??"";
    const offsetRaw=url.searchParams.get("utcOffsetSeconds");
    const offset=offsetRaw===null?NaN:Number(offsetRaw);
    if(!hevyId || hevyId.length>120 || !Number.isInteger(offset) ||
      Math.abs(offset)>50400 || offset%60!==0)
      return NextResponse.json({error:"Valid Hevy ID and UTC offset required"},{status:400});

    const prepared=await prepareConsolidatedExport(sql,hevyId,offset);
    if(!prepared.ready || !prepared.payload)
      return NextResponse.json(prepared,{status:422,headers:{"Cache-Control":"no-store"}});
    if(url.searchParams.get("download")==="1")
      return new Response(JSON.stringify(prepared.payload,null,2),{
        headers:{"Content-Type":"application/json; charset=utf-8",
          "Content-Disposition":`attachment; filename="hevy2garmin-${hevyId.replace(/[^a-zA-Z0-9_-]/g,"_")}.json"`,
          "Cache-Control":"no-store"},
      });
    return NextResponse.json(prepared,{headers:{"Cache-Control":"no-store"}});
  }catch(e){
    return NextResponse.json({ready:false,changes_made:false,
      error:e instanceof Error?e.message:"Cannot prepare preview"},{status:422,
      headers:{"Cache-Control":"no-store"}});
  }
}
