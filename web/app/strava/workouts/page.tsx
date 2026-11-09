import Link from "next/link";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StravaWorkouts() {
  let items: {hevy_id:string;title:string|null;garmin_activity_id:string|null;synced_at:string|null}[] = [];
  let error = "";
  try {
    const sql=getDb();
    const rows=await sql`SELECT hevy_id,title,garmin_activity_id,synced_at
      FROM synced_workouts WHERE status='success' AND garmin_activity_id IS NOT NULL
      ORDER BY synced_at DESC LIMIT 30`;
    items=rows.map(r=>({
      hevy_id:String(r.hevy_id),title:r.title == null?null:String(r.title),
      garmin_activity_id:r.garmin_activity_id == null?null:String(r.garmin_activity_id),
      synced_at:r.synced_at == null?null:String(r.synced_at),
    }));
  } catch {error="Não foi possível consultar o histórico Garmin.";}
  return <main className="max-w-4xl mx-auto px-4 py-8 space-y-5">
    <div><Link href="/strava" className="text-sm text-teal">← Strava</Link>
      <h1 className="text-2xl font-bold mt-2">Treinos para o Strava</h1>
      <p className="text-text-secondary text-sm mt-2">
        Histórico Garmin concluído. A auditoria inspeciona fontes e FC em modo somente leitura.
        Nenhuma atividade será enviada nesta etapa. O link de pré-visualização usa UTC−3 (São Paulo) como hipótese explícita: confira o fuso do treino antes de qualquer envio.</p>
    </div>
    {error && <p className="text-sm text-red-400">{error}</p>}
    <div className="rounded-xl border border-border bg-surface-elevated divide-y divide-border">
      {items.length===0 && <p className="p-4 text-text-secondary">Nenhum treino Garmin concluído disponível.</p>}
      {items.map(item=><div key={item.hevy_id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <div className="font-medium">{item.title || "Treino Hevy"}</div>
          <div className="text-xs text-text-secondary mt-1">Hevy {item.hevy_id} · Garmin {item.garmin_activity_id}</div>
        </div>
        <div className="flex flex-col gap-1">
          <a className="text-sm text-teal underline" href={`/api/strava/source-audit?hevyId=${encodeURIComponent(item.hevy_id)}`}>
            Auditar fontes
          </a>
          <a className="text-sm text-teal underline" href={`/api/strava/preview-json?hevyId=${encodeURIComponent(item.hevy_id)}&utcOffsetSeconds=-10800`}>
            Pré-visualizar JSON (UTC−3)
          </a>
        </div>
      </div>)}
    </div>
  </main>;
}
