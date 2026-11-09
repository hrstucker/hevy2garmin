import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getSessionEpoch } from "@/lib/session-epoch";
import { getDb } from "@/lib/db";
import { saveStravaMapping } from "@/lib/strava/mapping-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request:Request) {
  // Browser write must be same-origin. Server-side credentials are never returned.
  if (request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"Origin mismatch"},{status:403});
  let sql:ReturnType<typeof getDb>;
  try {sql=getDb();}catch{return NextResponse.json({error:"Database unavailable"},{status:503});}
  const epoch=await getSessionEpoch(sql);
  if (!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});
  let body:unknown;
  try {body=await request.json();}catch{return NextResponse.json({error:"Invalid JSON"},{status:400});}
  if (!body || typeof body!=="object" || Array.isArray(body))
    return NextResponse.json({error:"Invalid mapping"},{status:400});
  const input=body as Record<string,unknown>;
  if (typeof input.title!=="string" || typeof input.stravaType!=="string")
    return NextResponse.json({error:"Invalid mapping"},{status:400});
  try {
    const persisted=await saveStravaMapping(sql,input.title,input.stravaType);
    return NextResponse.json({saved:true,title:input.title,stravaType:persisted},
      {headers:{"Cache-Control":"no-store"}});
  }catch (error) {
    const invalid=error instanceof Error && error.message==="Invalid mapping";
    console.error("[strava-mappings] mapping write failed",error);
    return NextResponse.json({error:invalid?"Invalid mapping":"Mapping could not be saved or verified"},
      {status:invalid?400:503,headers:{"Cache-Control":"no-store"}});
  }
}
