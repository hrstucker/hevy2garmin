import Link from "next/link";
import { getDb } from "@/lib/db";
import { fetchAllWorkouts, type HevyWorkout } from "@/lib/hevy-sync";
import { loadStravaMappings } from "@/lib/strava/mapping-store";
import { SUGGESTED_HEVY_STRAVA_MAP, VERIFIED_STRAVA_EXERCISES } from "@/lib/strava/strava-mappings";
import { StravaMappingEditor } from "@/components/strava-mapping-editor";

export const dynamic = "force-dynamic";

export default async function StravaMappings() {
  let titles:string[]=[];
  let saved:Record<string,string>={};
  let error="";
  try {
    const sql=getDb();
    const [mappings,workouts]=await Promise.all([loadStravaMappings(sql),fetchAllWorkouts()]);
    saved=mappings;
    const set=new Set<string>();
    for(const w of workouts as HevyWorkout[]) {
      if(!Array.isArray(w.exercises)) continue;
      for(const raw of w.exercises) {
        const e=raw && typeof raw==="object" ? raw as Record<string,unknown> : {};
        if(typeof e.title==="string" && e.title.trim()) set.add(e.title);
      }
    }
    titles=[...set].sort((a,b)=>a.localeCompare(b,"pt-BR")).slice(0,300);
  }catch {error="Não foi possível carregar os exercícios do Hevy ou o banco de dados.";}
  return <main className="max-w-5xl mx-auto px-4 py-8 space-y-5">
    <div>
      <Link href="/strava" className="text-teal text-sm">← Strava</Link>
      <h1 className="text-2xl font-bold mt-2">Mapeamentos de exercícios</h1>
      <p className="text-text-secondary text-sm mt-2">
        Selecione explicitamente o exercício equivalente na lista documentada do Strava.
        Esses mapeamentos são independentes dos existentes para Garmin.
      </p>
      <p className="text-text-secondary text-sm mt-2">
        Sem equivalência fiel, mantenha Não mapeado. O exportador bloqueará o treino
        até decidirmos como representar o exercício, sem substituir silenciosamente.
      </p>
    </div>
    {error && <p className="text-red-400 text-sm">{error}</p>}
    <StravaMappingEditor titles={titles} saved={saved}
      suggestions={SUGGESTED_HEVY_STRAVA_MAP} supported={VERIFIED_STRAVA_EXERCISES}/>
  </main>;
}
