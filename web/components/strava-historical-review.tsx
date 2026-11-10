"use client";
import {useState} from "react";

export type HistoricalItem={
  hevyId:string;name:string;start:string;garminId:string;
  ledgerStatus:string|null;stravaActivityId:string|null;
};
type Audit={
  ready?:boolean;code?:string;error?:string;status?:string;
  fingerprint?:string;sets?:number;hrSamples?:number;
  possibleActivityIds?:string[];reasons?:string[];
  uploadId?:string;submitted?:boolean;
};
export function HistoricalReview({items}:{items:HistoricalItem[]}){
  const [reports,setReports]=useState<Record<string,Audit>>({});
  const [busy,setBusy]=useState<string|null>(null);
  const [approved,setApproved]=useState<Record<string,boolean>>({});
  async function action(item:HistoricalItem,operation:"audit"|"submit"){
    if(busy)return;
    setBusy(item.hevyId);
    try{
      const prior=reports[item.hevyId];
      const response=await fetch("/api/strava/historical",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          action:operation,hevyId:item.hevyId,
          ...(operation==="submit"?{
            fingerprint:prior?.fingerprint,
            confirmation:`HISTORICAL-UPLOAD:${item.hevyId}`
          }:{}),
        }),
      });
      const value=await response.json() as Audit;
      if(!response.ok && !value.error)value.error="Falha na auditoria ou importação";
      setReports(prev=>({...prev,[item.hevyId]:value}));
      setApproved(prev=>({...prev,[item.hevyId]:false}));
    }catch{
      setReports(prev=>({...prev,[item.hevyId]:{ready:false,error:"Não foi possível consultar o servidor"}}));
    }finally{setBusy(null);}
  }
  const imported=items.filter(i=>i.ledgerStatus==="ready").length;
  return <div className="space-y-4">
    <p className="text-sm text-text-secondary">
      {items.length} treinos históricos listados; {imported} importados com status concluído no registro local.
      Esta página não inicia envios automaticamente.
    </p>
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
            <button type="button" disabled={busy!==null}
              className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
              onClick={()=>void action(item,"audit")}>
              {busy===item.hevyId?"Auditando…":"Auditar antes de importar"}
            </button>
            {r && <div className="text-sm space-y-1">
              {r.submitted?<p className="text-teal font-semibold">
                Envio aceito pelo Strava (upload {r.uploadId}); aguarde o processamento e verifique o status.
              </p>:r.ready?<p className="text-teal">
                Pronto: {r.sets} séries, {r.hrSamples} amostras de FC. Nenhuma duplicação próxima identificada na consulta.
              </p>:<p className="text-amber-400">
                {r.error??"Auditoria pendente"} {r.reasons?.join("; ")}
                {r.possibleActivityIds?.length?
                  ` — Possíveis atividades: ${r.possibleActivityIds.join(", ")}`:""}
              </p>}
              {r.ready && r.fingerprint && <div className="space-y-2">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={Boolean(approved[item.hevyId])}
                    onChange={event=>setApproved(prev=>({...prev,[item.hevyId]:event.target.checked}))}/>
                  <span>Revisei data, exercícios, FC e possíveis duplicações. Autorizo o envio
                    exclusivamente deste treino histórico ao Strava.</span>
                </label>
                <button type="button" disabled={!approved[item.hevyId]||busy!==null}
                  onClick={()=>void action(item,"submit")}
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
