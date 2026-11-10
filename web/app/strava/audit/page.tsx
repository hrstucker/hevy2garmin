import Link from "next/link";
import {getDb} from "@/lib/db";
import {fetchAllWorkouts} from "@/lib/hevy-sync";
import {cachedHr,loadHrBackup} from "@/lib/hr-store";

export const dynamic="force-dynamic";

/** Human-readable read-only source audit; proxy protects this page by session. */
export default async function SourceAuditPage({searchParams}:{
  searchParams:Promise<{hevyId?:string;manualFit?:string}>;
}){
  const {hevyId="",manualFit=""}=await searchParams;
  let title="Auditoria de fontes",garminId="",start="",end="";
  let calories:number|null=null,exercises:{name:string;sets:number}[]=[];
  let cachedCount=0,backupCount=0,error="";
  if(!hevyId || hevyId.length>120)error="Identificador do treino inválido.";
  else try{
    const sql=getDb();
    const rows=await sql`SELECT garmin_activity_id,status,title,calories
      FROM synced_workouts WHERE hevy_id=${hevyId} LIMIT 1`;
    const row=rows[0];
    if(!row || row.status!=="success" || !row.garmin_activity_id){
      error="Treino sem sincronização Garmin concluída.";
    }else{
      garminId=String(row.garmin_activity_id);
      calories=typeof row.calories==="number"?row.calories:null;
      const workouts=await fetchAllWorkouts();
      const w=workouts.find(x=>x.id===hevyId);
      if(!w)error="Treino não localizado no Hevy.";
      else{
        title=typeof w.title==="string"?w.title:String(row.title??"Treino");
        start=w.start_time??"";
        end=w.end_time??"";
        exercises=Array.isArray(w.exercises)?w.exercises.map(item=>{
          const x=item && typeof item==="object" ? item as Record<string,unknown> : {};
          return {name:typeof x.title==="string"?x.title:"Exercício sem nome",
            sets:Array.isArray(x.sets)?x.sets.length:0};
        }):[];
        const [cache,backup]=await Promise.all([
          cachedHr(sql,hevyId),
          loadHrBackup(sql,{id:hevyId,start_time:w.start_time,end_time:w.end_time})
        ]);
        cachedCount=cache?.length??0;
        backupCount=backup?.length??0;
      }
    }
  }catch{
    error="Não foi possível consultar as fontes deste treino.";
  }
  const ready=(cachedCount>0 || backupCount>0) && !error;
  return <main className="max-w-3xl mx-auto px-4 py-8 space-y-5">
    <Link href={`/strava/preview?hevyId=${encodeURIComponent(hevyId)}&utcOffsetSeconds=-10800`}
      className="text-teal text-sm">← Voltar à prévia</Link>
    <h1 className="text-2xl font-bold">Auditoria das fontes do treino</h1>
    <p className="text-text-secondary text-sm">
      Consulta somente de leitura. Nenhuma atividade é enviada ou modificada.
    </p>
    {error?<p className="text-red-400">{error}</p>:<>
      <section className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm">Garmin: {garminId}</p>
        <p className="text-sm">Início Hevy: {start||"Indisponível"}</p>
        <p className="text-sm">Fim Hevy: {end||"Indisponível"}</p>
        <p className="text-sm">Exercícios: {exercises.length}; séries: {exercises.reduce((n,e)=>n+e.sets,0)}</p>
        <p className="text-sm">Calorias no histórico local: {calories??"Indisponíveis"}</p>
      </section>
      <section className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
        <h2 className="font-semibold">Frequência cardíaca</h2>
        <p className="text-sm">Cache: {cachedCount} amostras</p>
        <p className="text-sm">Backup: {backupCount} amostras</p>
        <p className={ready?"text-teal font-semibold":"text-amber-400 font-semibold"}>
          {ready?"Amostras disponíveis":"Nenhuma amostra disponível nas fontes atuais"}
        </p>
        {!ready && <p className="text-sm text-text-secondary">
          Isso não significa que o Garmin não tenha registrado FC. Apenas as fontes
          consultadas pelo exportador não possuem amostras recuperáveis neste momento.
          O envio ao Strava continua bloqueado.
        </p>}
      </section>
      <section className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3">
        <h2 className="font-semibold">FIT original do relógio</h2>
        <p className="text-sm text-text-secondary">
          Se a recuperação automática falhar, selecione o arquivo .fit exportado do relógio.
          A aplicação confere a integridade do arquivo e seu horário com o treino Hevy
          antes de incorporar qualquer medição. Não envia dados ao Garmin ou Strava.
        </p>
        {manualFit==="ok" && <p className="text-sm text-teal font-medium">
          FIT validado. Frequência cardíaca extraída e armazenada no cache local.
        </p>}
        {manualFit==="no_hr" && <p className="text-sm text-amber-400 font-medium">
          FIT validado sem amostras de frequência cardíaca; ausência registrada.
        </p>}
        {manualFit==="rejected" && <p className="text-sm text-red-400">
          O arquivo não pôde ser validado para este treino. Nenhum dado foi incorporado.
        </p>}
        {manualFit==="invalid" && <p className="text-sm text-red-400">
          Selecione um arquivo .fit válido de até 16 MiB.
        </p>}
        <form action="/api/strava/upload-watch-fit" method="post"
          encType="multipart/form-data" className="space-y-3">
          <input type="hidden" name="hevyId" value={hevyId}/>
          <label htmlFor="watch-fit" className="block text-sm font-medium">Arquivo do relógio</label>
          <input id="watch-fit" name="fit" type="file" accept=".fit,application/octet-stream"
            required className="block w-full text-sm"/>
          <button type="submit" className="rounded-lg border border-teal px-3 py-2 text-sm text-teal">
            Auditar e recuperar dados do FIT
          </button>
        </form>
        <p className="text-xs text-text-secondary">
          A identidade é conferida pelo início da atividade; o ID Garmin Connect não
          é provado apenas pelo nome do arquivo. A origem fica registrada separadamente.
        </p>
      </section>
      <section className="rounded-xl border border-border bg-surface-elevated p-4">
        <h2 className="font-semibold mb-3">Exercícios do Hevy</h2>
        <div className="divide-y divide-border">
          {exercises.map((e,i)=><div key={i} className="py-2 flex justify-between gap-4 text-sm">
            <span>{e.name}</span><span className="text-text-secondary">{e.sets} séries</span>
          </div>)}
        </div>
      </section>
      <p className="text-xs text-text-secondary">
        Disponibilidade de amostras não equivale à validação de todos os mapeamentos.
        Utilize a prévia consolidada para verificar se a exportação está pronta.
      </p>
    </>}
  </main>;
}
