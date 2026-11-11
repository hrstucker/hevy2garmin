"use client";
import {useRef,useState} from "react";

type Candidate={hevyId:string;activityId:string;match:boolean};
type Inspection={items:Candidate[];eligible:number;error?:string};

export function StravaDescriptionCleanup(){
  const [inspected,setInspected]=useState<Inspection|null>(null);
  const [approved,setApproved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [status,setStatus]=useState("");
  const inProgress=useRef(false);

  async function request(action:"inspect"|"clear",hevyId?:string){
    const response=await fetch("/api/strava/cleanup-descriptions",{
      method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
      body:JSON.stringify({action,hevyId,...(action==="clear"?{
        confirmation:`REMOVE-GENERATED-DESCRIPTION:${hevyId}`
      }:{})})
    });
    const data=await response.json() as Inspection&{cleared?:boolean};
    if(!response.ok)throw new Error(data.error??"Falha na consulta ao Strava");
    return data;
  }

  async function inspect(){
    if(inProgress.current)return;
    inProgress.current=true;setBusy(true);setApproved(false);setInspected(null);
    setStatus("Comparando descrições atuais com os textos automáticos da aplicação…");
    try{
      const result=await request("inspect");
      setInspected(result);
      setStatus(`Encontradas ${result.eligible} descrições automáticas idênticas, entre ${result.items.length} atividades registradas.`);
    }catch(e){setStatus(e instanceof Error?e.message:"Não foi possível auditar descrições");}
    finally{inProgress.current=false;setBusy(false);}
  }

  async function clearAll(){
    if(inProgress.current||!approved||!inspected)return;
    inProgress.current=true;setBusy(true);setApproved(false);
    const targets=inspected.items.filter(item=>item.match);
    let cleared=0;
    try{
      for(const item of targets){
        setStatus(`Removendo anotação ${cleared+1} de ${targets.length}…`);
        // The server re-reads current Strava description and refuses to
        // overwrite anything that changed after the audit.
        await request("clear",item.hevyId);
        cleared++;
      }
      setStatus(`Concluído: ${cleared} descrições automáticas removidas. Nenhum treino foi excluído.`);
      setInspected(null);
    }catch(e){
      setStatus(`Interrompido após ${cleared} remoções: ${e instanceof Error?e.message:"resultado incerto"}. Audite novamente antes de continuar.`);
      setInspected(null);
    }finally{inProgress.current=false;setBusy(false);}
  }

  return <section className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3">
    <h2 className="font-semibold">Remover descrições automáticas do Strava</h2>
    <p className="text-sm text-text-secondary">
      Remove, em lote, somente as anotações geradas pelo Hevy2Garmin que ainda
      estejam exatamente iguais no Strava. Preserva descrições pessoais, título,
      séries, cargas, frequência cardíaca e as atividades.
    </p>
    <button type="button" onClick={()=>void inspect()} disabled={busy}
      className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40">
      Auditar descrições existentes
    </button>
    {inspected&&<div className="space-y-2 text-sm">
      <p>{inspected.eligible} atividades com descrição automática idêntica;
        {" "}{inspected.items.length-inspected.eligible} sem correspondência, preservadas.</p>
      {inspected.eligible>0&&<>
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}
            disabled={busy}/>
          <span>Autorizo limpar as {inspected.eligible} descrições automáticas identificadas,
            sem excluir nenhuma atividade.</span>
        </label>
        <button type="button" disabled={!approved||busy} onClick={()=>void clearAll()}
          className="rounded-lg border border-teal px-3 py-2 font-medium text-teal disabled:opacity-40">
          Limpar descrições automáticas em lote
        </button>
      </>}
    </div>}
    {status&&<p role="status" className="text-sm text-text-secondary">{status}</p>}
  </section>;
}
