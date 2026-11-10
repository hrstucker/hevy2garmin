import Link from "next/link";
import {getDb} from "@/lib/db";
import {fetchAllWorkouts,type HevyWorkout} from "@/lib/hevy-sync";
import {historicalWorkoutEligible} from "@/lib/strava/historical-policy";
import {HistoricalReview,type HistoricalItem} from "@/components/strava-historical-review";

export const dynamic="force-dynamic";
/** Read-only queue: never schedules historical uploads. */
export default async function HistoricalStravaPage(){
  const items:HistoricalItem[]=[];
  let error="";
  try{
    const sql=getDb();
    const [rows,workouts]=await Promise.all([
      sql`SELECT s.hevy_id,s.garmin_activity_id,
        u.status AS strava_status,u.activity_id AS strava_activity_id
        FROM synced_workouts s
        LEFT JOIN strava_uploads u ON u.hevy_id=s.hevy_id
        WHERE s.status='success' AND s.garmin_activity_id IS NOT NULL
        ORDER BY s.synced_at DESC LIMIT 500`,
      fetchAllWorkouts()
    ]);
    const byId=new Map((workouts as HevyWorkout[]).map(w=>[w.id,w]));
    for(const row of rows){
      const hevyId=String(row.hevy_id);
      const w=byId.get(hevyId);
      if(!w?.start_time||!historicalWorkoutEligible(w.start_time))continue;
      items.push({
        hevyId,name:w.title??"Treino Hevy",start:w.start_time,
        garminId:String(row.garmin_activity_id),
        ledgerStatus:row.strava_status?String(row.strava_status):null,
        stravaActivityId:row.strava_activity_id?String(row.strava_activity_id):null,
      });
    }
    items.sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
  }catch{
    error="Não foi possível carregar o histórico Hevy, Garmin e Strava.";
  }
  return <main className="max-w-4xl mx-auto px-4 py-8 space-y-5">
    <Link href="/strava" className="text-sm text-teal">← Strava</Link>
    <h1 className="text-2xl font-bold">Reconciliação histórica Strava</h1>
    <p className="text-sm text-text-secondary">
      Lista de treinos anteriores a 10/11/2026 às 15h de Brasília. A data do treino
      é obtida do Hevy, não da sincronização. A consulta de duplicações no Strava
      acontece individualmente na auditoria. A aprovação é explícita por treino;
      não existe importação histórica agendada ou em massa sem revisão.
    </p>
    <p className="text-sm text-text-secondary">
      {process.env.STRAVA_HISTORICAL_UPLOADS_ENABLED==="true"
        ?"Importação histórica habilitada neste deployment. A auditoria não envia atividades."
        :"Importação histórica desabilitada neste deployment. É possível auditar sem enviar."}
    </p>
    {error?<p className="text-red-400">{error}</p>:
      <HistoricalReview items={items} uploadsEnabled={process.env.STRAVA_HISTORICAL_UPLOADS_ENABLED==="true"}/>}
  </main>;
}
