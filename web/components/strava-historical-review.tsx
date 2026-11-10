"use client";
import {useRef,useState} from "react";

export type HistoricalItem={
  hevyId:string;name:string;start:string;garminId:string;
  ledgerStatus:string|null;stravaActivityId:string|null;
};
type Audit={
  ready?:boolean;code?:string;error?:string;status?:string;
  fingerprint?:string;sets?:number;hrSamples?:number;
  possibleActivityIds?:string[];reasons?:string[];
  uploadId?:string;submitted?:boolean;stravaActivityId?:string|null;
};
type Outcome="ready"|"blocked"|"accepted"|"completed"|"halted";
const wait=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const textError=(r:Audit)=>[r.error??"Auditoria bloqueada",...(r.reasons??[])].join("; ");

/** Every upload requires its own up-to-date Strava duplicate lookup and
 * idempotency reservation. A bulk click is NOT a server-side backfill job.
 * Sequential client requests make failures visible and stop on ambiguity.
 */
export function HistoricalReview({items}:{items:HistoricalItem[]}){
  const [reports,setReports]=useState<Record<string,Audit>>({});
  const [approved,setApproved]=useState<Record<string,boolean>>({});
  const [auditComplete,setAuditComplete]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [bulkMode,setBulkMode]=useState<"idle"|"auditing"|"sending">("idle");
  const [bulkText,setBulkText]=useState("");
  const [bulkApproved,setBulkApproved]=useState(false);
  const [outcomes,setOutcomes]=useState<Record<string,Outcome>>({});
  const runLock=useRef(false);

  async function api(hevyId:string,action:"audit"|"submit",fingerprint?:string):Promise<Audit>{
    const response=await fetch("/api/strava/historical",{
      method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
      body:JSON.stringify({
        action,hevyId,
        ...(action==="submit"?{
          fingerprint,confirmation:`HISTORICAL-UPLOAD:${hevyId}`
        }:{}),
      }),
    });
    const value=await response.json() as Audit;
    if(!response.ok){
      return {...value,ready:false,error:value.error??`HTTP ${response.status}`};
    }
    return value;
  }

  async function pollUntilResolved(hevyId:string):Promise<"ready"|"stopped">{
    // Do not automatically resubmit, even after a timeout or an error.
    for(let tries=0;tries<25;tries++){
      const response=await fetch("/api/strava/check-upload",{
        method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",
        body:JSON.stringify({hevyId})
      });
      const state=await response.json() as {
        status?:string;error?:string;stravaActivityId?:string|null;activityId?:string|null;
      };
      if(!response.ok)throw new Error(state.error??"Não foi possível verificar envio anterior");
      if(state.status==="ready"){
        setReports(prev=>({...prev,[hevyId]:{
          ...prev[hevyId],ready:false,submitted:true,status:"ready",
          stravaActivityId:state.stravaActivityId??state.activityId??null
        }}));
        return "ready";
      }
      if(state.status==="failed"||state.status==="unknown"||state.status==="submitting")
        throw new Error(`Envio ${state.status}; revisão manual necessária antes de continuar`);
      await wait(2500);
    }
    return "stopped";
  }

  async function auditAll(){
    if(runLock.current)return;
    runLock.current=true;setBulkMode("auditing");setBulkApproved(false);
    setAuditComplete(false);setOutcomes({});setReports({});
    setBulkText("Iniciando auditoria de treinos históricos…");
    const next:Record<string,Audit>={};
    const state:Record<string,Outcome>={};
    try{
      const candidates=items.filter(i=>!i.ledgerStatus);
      for(let i=0;i<candidates.length;i++){
        const item=candidates[i];
        setBulkText(`Auditando ${i+1}/${candidates.length}: ${item.name}`);
        try{
          const audit=await api(item.hevyId,"audit");
          next[item.hevyId]=audit;
          state[item.hevyId]=audit.ready?"ready":"blocked";
          setReports(prev=>({...prev,[item.hevyId]:audit}));
          setOutcomes(prev=>({...prev,[item.hevyId]:state[item.hevyId]}));
          // If OAuth/DB/network is down, don't mislabel the remaining sessions as ready.
          if(audit.error?.startsWith("Could not verify")){
            setBulkText("Auditoria interrompida por indisponibilidade das fontes. Nenhum envio realizado.");
            return;
          }
        }catch{
          const error={ready:false,error:"Falha de rede ao auditar. Nenhum envio realizado."};
          next[item.hevyId]=error;state[item.hevyId]="blocked";
          setReports(prev=>({...prev,[item.hevyId]:error}));
          setOutcomes(prev=>({...prev,[item.hevyId]:"blocked"}));
          setBulkText("Auditoria interrompida por erro de rede. Nenhum envio realizado.");
          return;
        }
      }
      const ready=Object.values(next).filter(r=>r.ready).length;
      setAuditComplete(true);
      setBulkText(`Auditoria concluída: ${ready} prontos, ${candidates.length-ready} bloqueados ou pendentes e ${items.length-candidates.length} já registrados no Strava. Confira os resultados antes do envio.`);
    }finally{
      runLock.current=false;setBulkMode("idle");
    }
  }

  async function sendAll(){
    if(runLock.current||!bulkApproved||!auditComplete)return;
    const selected=items.filter(i=>!i.ledgerStatus&&outcomes[i.hevyId]==="ready"&&reports[i.hevyId]?.ready&&reports[i.hevyId]?.fingerprint);
    if(!selected.length)return;
    runLock.current=true;setBulkMode("sending");setBulkApproved(false);
    let completed=0;
    try{
      for(const item of selected){
        setBulkText(`Enviando ${completed+1}/${selected.length}: ${item.name}`);
        let receipt:Audit;
        try{
          receipt=await api(item.hevyId,"submit",reports[item.hevyId].fingerprint);
        }catch{
          setOutcomes(prev=>({...prev,[item.hevyId]:"halted"}));
          setBulkText("Interrompido: conexão perdida durante envio. Resultado incerto; não repetir sem conciliar com Strava.");
          return;
        }
        setReports(prev=>({...prev,[item.hevyId]:receipt}));
        if(!receipt.submitted){
          setOutcomes(prev=>({...prev,[item.hevyId]:"halted"}));
          setBulkText(`Importação interrompida em ${item.name}: ${textError(receipt)}. Nenhuma repetição automática.`);
          return;
        }
        setOutcomes(prev=>({...prev,[item.hevyId]:"accepted"}));
        try{
          if(await pollUntilResolved(item.hevyId)!=="ready"){
            setBulkText(`Envio de ${item.name} ainda processando. Lote pausado para evitar sobreposição; verifique o Strava.`);
            return;
          }
        }catch(error){
          setBulkText(`Lote pausado após ${item.name}: ${error instanceof Error?error.message:"resultado incerto"}.`);
          return;
        }
        completed++;
        setOutcomes(prev=>({...prev,[item.hevyId]:"completed"}));
      }
      setBulkText(`Lote concluído: ${completed} treinos confirmados como importados. Recarregue a página para atualizar o histórico local.`);
    }finally{
      runLock.current=false;setBulkMode("idle");
    }
  }

  async function single(item:HistoricalItem,operation:"audit"|"submit"){
    if(runLock.current)return;
    runLock.current=true;setBusy(item.hevyId);
    try{
      const report=await api(item.hevyId,operation,reports[item.hevyId]?.fingerprint);
      setReports(prev=>({...prev,[item.hevyId]:report}));
      setOutcomes(prev=>({...prev,[item.hevyId]:report.submitted?"accepted":report.ready?"ready":"blocked"}));
    }catch{
      const error={ready:false,error:"Falha de rede; verifique Strava antes de repetir."};
      setReports(prev=>({...prev,[item.hevyId]:error}));
    }finally{setBusy(null);runLock.current=false;}
  }

  const eligible=items.filter(i=>!i.ledgerStatus);
  const ready=eligible.filter(i=>auditComplete&&outcomes[i.hevyId]==="ready"&&reports[i.hevyId]?.ready&&reports[i.hevyId]?.fingerprint);
  const confirmed=items.filter(i=>i.ledgerStatus==="ready").length;
  const locked=bulkMode!=="idle"||busy!==null;
  return <div className="space-y-4">
    <section className="rounded-xl border border-teal bg-surface-elevated p-4 space-y-3">
      <h2 className="text-lg font-semibold">Importação histórica em lote</h2>
      <p className="text-sm text-text-secondary">
        {items.length} treinos históricos encontrados · {confirmed} concluídos no registro Strava ·
        {" "}{eligible.length} candidatos a auditoria. O sistema verifica cada treino
        contra as fontes e contra atividades existentes no Strava antes de permitir o envio.
      </p>
      <button type="button" disabled={locked||eligible.length===0}
        onClick={()=>void auditAll()}
        className="rounded-lg border border-teal px-4 py-2 font-medium text-teal disabled:opacity-40">
        {bulkMode==="auditing"?"Auditando todos…":"1. Auditar todos os treinos"}
      </button>
      <div className="text-sm text-text-secondary">
        Após a auditoria: <strong>{ready.length} prontos</strong> para uma possível importação.
        Treinos bloqueados ou já registrados nunca entram no lote.
      </div>
      {auditComplete && ready.length>0 && bulkMode!=="auditing" && <div className="space-y-3 border-t border-border pt-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={bulkApproved} disabled={locked}
            onChange={e=>setBulkApproved(e.target.checked)}/>
          <span>Revisei a auditoria e autorizo importar os {ready.length} treinos identificados
          como prontos. Entendo que cada atividade será enviada uma vez, em sequência,
          sem reenvio automático em caso de falha.</span>
        </label>
        <button type="button" disabled={locked||!bulkApproved}
          onClick={()=>void sendAll()}
          className="rounded-lg bg-teal px-4 py-2 font-medium text-black disabled:opacity-40">
          {bulkMode==="sending"?"Enviando lote…":`2. Importar {ready.length} treinos aprovados`}
        </button>
      </div>}
      {bulkText && <p role="status" className="text-sm font-medium">{bulkText}</p>}
      <p className="text-xs text-text-secondary">
        A execução depende desta página aberta. Se a conexão cair ou o Strava não confirmar
        um envio, o lote para. Nenhuma solicitação de envio é repetida automaticamente.
        O controle STRAVA_HISTORICAL_UPLOADS_ENABLED precisa estar ativo na produção.
      </p>
    </section>
    <div className="divide-y divide-border rounded-xl border border-border bg-surface-elevated">
      {items.map(item=>{
        const r=reports[item.hevyId];
        const hasLedger=Boolean(item.ledgerStatus);
        return <section key={item.hevyId} className="p-4 space-y-2">
          <div className="font-medium">{item.name}</div>
          <p className="text-xs text-text-secondary">
            Início: {new Date(item.start).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})} · Garmin {item.garminId}
          </p>
          <p className="text-sm">
            {hasLedger?`Registro Strava: ${item.ledgerStatus}`:"Sem envio registrado no histórico local"}
            {item.stravaActivityId&&<> · <a className="text-teal underline" href={`https://www.strava.com/activities/${item.stravaActivityId}`}
              target="_blank" rel="noopener noreferrer">Abrir atividade</a></>}
          </p>
          <div className="flex gap-3 flex-wrap text-sm">
            <a href={`/strava/audit?hevyId=${encodeURIComponent(item.hevyId)}`}
               className="text-teal underline">Fontes</a>
            <a href={`/strava/preview?hevyId=${encodeURIComponent(item.hevyId)}&utcOffsetSeconds=-10800`}
               className="text-teal underline">Prévia consolidada</a>
          </div>
          {!hasLedger && <div className="space-y-2">
            <button type="button" disabled={locked}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
              onClick={()=>void single(item,"audit")}>
              {busy===item.hevyId?"Auditando…":"Auditar individualmente"}
            </button>
            {r && <div className="text-sm space-y-1">
              {r.submitted?<p className="text-teal font-semibold">
                Envio aceito pelo Strava (upload {r.uploadId??"registrado"}).
                {r.status==="ready"?" Processamento concluído.":" Verifique o processamento."}
              </p>:r.ready?<p className="text-teal">
                Pronto: {r.sets} séries, {r.hrSamples} amostras de FC. Consulta de duplicações realizada.
              </p>:<p className="text-amber-400">
                {textError(r)} {r.possibleActivityIds?.length?
                  ` — Possíveis atividades: ${r.possibleActivityIds.join(", ")}`:""}
              </p>}
              {r.ready && r.fingerprint && <div className="space-y-2">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={Boolean(approved[item.hevyId])}
                    onChange={e=>setApproved(prev=>({...prev,[item.hevyId]:e.target.checked}))}/>
                  <span>Autorizo o envio exclusivamente deste treino histórico.</span>
                </label>
                <button type="button" disabled={!approved[item.hevyId]||locked}
                  onClick={()=>void single(item,"submit")}
                  className="rounded-lg border border-teal px-3 py-2 text-sm text-teal disabled:opacity-40">
                  Enviar este treino uma vez
                </button>
              </div>}
            </div>}
          </div>}
        </section>;
      })}
    </div>
  </div>;
}
