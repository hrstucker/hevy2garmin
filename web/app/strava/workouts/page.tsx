import Link from "next/link";
import { getDb } from "@/lib/db";
import { fetchAllWorkouts, type HevyWorkout } from "@/lib/hevy-sync";

export const dynamic = "force-dynamic";

interface Item {
  hevy_id:string;
  title:string|null;
  garmin_activity_id:string|null;
  synced_at:string|null;
  workout_start:string|null;
  strava_status:string|null;
  strava_activity_id:string|null;
}
const ZONE = "America/Sao_Paulo";

function validDateTime(raw:string|null):Date|null {
  if(!raw) return null;
  // An offset-free timestamp cannot be assigned a timezone without guessing.
  if(!/(?:Z|[+-]\d\d:\d\d)$/i.test(raw)) return null;
  const d=new Date(raw);
  return Number.isFinite(d.getTime())?d:null;
}
function workoutDay(raw:string|null):string|null {
  const d=validDateTime(raw);
  if(!d)return null;
  const parts=new Intl.DateTimeFormat("en-US", {
    timeZone:ZONE,year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(d);
  const field=(kind:string)=>parts.find(p=>p.type===kind)?.value??"";
  return `${field("year")}-${field("month")}-${field("day")}`;
}
function workoutLabel(raw:string|null):string {
  const d=validDateTime(raw);
  return d?new Intl.DateTimeFormat("pt-BR",{
    timeZone:ZONE,day:"2-digit",month:"2-digit",year:"numeric",
    hour:"2-digit",minute:"2-digit",
  }).format(d):"Data do treino indisponível";
}

export default async function StravaWorkouts({searchParams}:{
  searchParams:Promise<{date?:string}>;
}) {
  const {date}=await searchParams;
  const selectedDate=typeof date==="string" && /^\d{4}-\d{2}-\d{2}$/.test(date)?date:null;
  let items:Item[]=[];
  let error="";
  let datesAvailable=true;
  try {
    const sql=getDb();
    const rows=await sql`SELECT s.hevy_id,s.title,s.garmin_activity_id,s.synced_at,
      u.status AS strava_status,u.activity_id AS strava_activity_id
      FROM synced_workouts s LEFT JOIN strava_uploads u ON u.hevy_id=s.hevy_id WHERE s.status='success' AND s.garmin_activity_id IS NOT NULL
      ORDER BY s.synced_at DESC LIMIT 100`;
    items=rows.map(r=>({
      hevy_id:String(r.hevy_id),title:r.title==null?null:String(r.title),
      garmin_activity_id:r.garmin_activity_id==null?null:String(r.garmin_activity_id),
      synced_at:r.synced_at==null?null:r.synced_at instanceof Date?r.synced_at.toISOString():String(r.synced_at),
      workout_start:null,
      strava_status:r.strava_status==null?null:String(r.strava_status),
      strava_activity_id:r.strava_activity_id==null?null:String(r.strava_activity_id),
    }));
    try {
      const workouts=await fetchAllWorkouts();
      const byId=new Map((workouts as HevyWorkout[]).map(w=>[w.id,w]));
      items=items.map(item=>{
        const source=byId.get(item.hevy_id);
        return {...item,
          title:typeof source?.title==="string"?source.title:item.title,
          workout_start:typeof source?.start_time==="string"?source.start_time:null,
        };
      });
    }catch{
      datesAvailable=false;
    }
  }catch{error="Não foi possível consultar o histórico Garmin.";}
  const visible=selectedDate?items.filter(item=>workoutDay(item.workout_start)===selectedDate):items;
  return <main className="max-w-4xl mx-auto px-4 py-8 space-y-5">
    <div>
      <Link href="/strava" className="text-sm text-teal">← Strava</Link>
      <h1 className="text-2xl font-bold mt-2">Treinos para o Strava</h1>
      <p className="text-text-secondary text-sm mt-2">
        Data e horário reais do início do treino Hevy, apresentados no fuso de
        São Paulo. A data de sincronização com o Garmin é exibida separadamente.
        Nenhuma atividade será enviada nesta etapa.
      </p>
    </div>
    <form action="/strava/workouts" method="get"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-surface-elevated p-4">
      <label className="text-sm text-text-secondary">
        Localizar treino pela data
        <input type="date" name="date" defaultValue={selectedDate??""}
          className="block mt-1 rounded-md border border-border bg-base text-text p-2"/>
      </label>
      <button type="submit" className="rounded-md border border-border px-4 py-2 text-sm">
        Filtrar
      </button>
      <Link href="/strava/workouts" className="text-sm text-teal underline p-2">
        Mostrar todos
      </Link>
    </form>
    {error && <p className="text-sm text-red-400">{error}</p>}
    {!datesAvailable && <p className="text-sm text-amber-400">
      O Hevy não respondeu à consulta das datas. Não estou usando a data de
      sincronização como se fosse a data do treino.
    </p>}
    <div className="rounded-xl border border-border bg-surface-elevated divide-y divide-border">
      {visible.length===0 && <p className="p-4 text-text-secondary">
        Nenhum treino encontrado{selectedDate?` para ${selectedDate.split("-").reverse().join("/")}`:""} nos 100 registros Garmin mais recentes.
      </p>}
      {visible.map(item=><div key={item.hevy_id}
        className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="space-y-1">
          <div className="font-medium">{item.title || "Treino Hevy"}</div>
          <div className={item.workout_start?"text-sm font-semibold text-teal":"text-sm text-amber-400"}>
            Treino: {workoutLabel(item.workout_start)}
          </div>
          {item.synced_at && <div className="text-xs text-text-secondary">
            Sincronizado com Garmin: {workoutLabel(item.synced_at)}
          </div>}
          <div className="text-xs text-text-secondary">
            Hevy {item.hevy_id} · Garmin {item.garmin_activity_id}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <a className="text-sm text-teal underline"
            href={`/api/strava/source-audit?hevyId=${encodeURIComponent(item.hevy_id)}`}>
            Auditar fontes
          </a>
          <a className="text-sm text-teal underline"
            href={`/strava/preview?hevyId=${encodeURIComponent(item.hevy_id)}&utcOffsetSeconds=-10800`}>
            Ver prévia consolidada (UTC−3)
          </a>
        </div>
      </div>)}
    </div>
  </main>;
}
