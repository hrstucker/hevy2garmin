import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {authEnabled,verifySession,SESSION_COOKIE} from "@/lib/auth";
import {getSessionEpoch} from "@/lib/session-epoch";
import {getDb} from "@/lib/db";
import {getStravaAccessToken} from "@/lib/strava/authenticated-client";

export const runtime="nodejs";
export const dynamic="force-dynamic";

// Only these exact app-generated descriptions can be removed. Never edit
// manually authored descriptions, unrelated activities, or activity data.
const GENERATED_DESCRIPTIONS=new Set([
  "Treino histórico Hevy + Garmin, importado individualmente após auditoria. Hevy2Garmin.",
  "Treino Hevy com séries, cargas e frequência cardíaca Garmin. Consolidado por Hevy2Garmin.",
  "Treino consolidado do Hevy com frequência cardíaca Garmin. Enviado por Hevy2Garmin."
]);

async function fetchStravaDescription(token:string,id:string):Promise<string|null>{
  const response=await fetch(`https://www.strava.com/api/v3/activities/${id}`,{
    headers:{Authorization:`Bearer ${token}`},cache:"no-store"
  });
  if(!response.ok)throw new Error(`Strava activity lookup HTTP ${response.status}`);
  const item=await response.json() as {description?:unknown};
  return typeof item.description==="string"?item.description:null;
}

export async function POST(request:Request){
  if(request.headers.get("origin")!==new URL(request.url).origin)
    return NextResponse.json({error:"Cross-origin request rejected"},{status:403});
  const sql=getDb();
  const epoch=await getSessionEpoch(sql);
  if(!authEnabled()||!await verifySession((await cookies()).get(SESSION_COOKIE)?.value??null,epoch))
    return NextResponse.json({error:"Unauthorized"},{status:401});
  let body:unknown;
  try{body=await request.json()}catch{return NextResponse.json({error:"Invalid JSON"},{status:400})}
  const data=body&&typeof body==="object"&&!Array.isArray(body)?body as Record<string,unknown>:{};
  const action=data.action,hevyId=data.hevyId;
  if(action!=="inspect"&&action!=="clear")
    return NextResponse.json({error:"Invalid operation"},{status:400});

  // The ledger is authoritative about which Strava activities this app created.
  // Does not operate on Garmin-synced activities or unrelated uploads.
  const rows=await sql`SELECT hevy_id,activity_id FROM strava_uploads
    WHERE status='ready' AND activity_id IS NOT NULL
    ORDER BY submitted_at DESC LIMIT 100`;
  const matches=rows.map(r=>({hevyId:String(r.hevy_id),activityId:String(r.activity_id)}))
    .filter(r=>/^[0-9]+$/.test(r.activityId));
  try{
    const token=await getStravaAccessToken();
    if(action==="inspect"){
      const findings:{hevyId:string;activityId:string;match:boolean}[]=[];
      for(const item of matches){
        const description=await fetchStravaDescription(token,item.activityId);
        findings.push({...item,match:GENERATED_DESCRIPTIONS.has(description??"")});
      }
      return NextResponse.json({items:findings,eligible:findings.filter(item=>item.match).length},
        {headers:{"Cache-Control":"no-store"}});
    }
    if(typeof hevyId!=="string"||!matches.some(item=>item.hevyId===hevyId)||
       data.confirmation!==`REMOVE-GENERATED-DESCRIPTION:${hevyId}`)
      return NextResponse.json({error:"Invalid record or confirmation"},{status:400});
    const id=matches.find(item=>item.hevyId===hevyId)!.activityId;
    const before=await fetchStravaDescription(token,id);
    if(!GENERATED_DESCRIPTIONS.has(before??""))
      return NextResponse.json({error:"Description is absent or modified; refusing to overwrite it"},{status:409});
    const response=await fetch(`https://www.strava.com/api/v3/activities/${id}`,{
      method:"PUT",
      headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({description:""}),
      cache:"no-store"
    });
    if(!response.ok)throw new Error(`Strava description update HTTP ${response.status}`);
    // Read back to avoid reporting success from an ignored field.
    const after=await fetchStravaDescription(token,id);
    if(after!==""&&after!==null)
      return NextResponse.json({error:"Strava did not confirm the description was cleared"},{status:502});
    return NextResponse.json({cleared:true,hevyId,activityId:id});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"Strava unavailable"},{status:502});
  }
}
