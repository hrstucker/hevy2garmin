"use client";

import {useState} from "react";

type Result={mode?:string;hevyId?:string;reason?:string;status?:string;uploadId?:string;activityId?:string;error?:string};

export function RecoverPendingForm(){
  const [hevyId,setHevyId]=useState("");
  const [confirmed,setConfirmed]=useState(false);
  const [pending,setPending]=useState(false);
  const [result,setResult]=useState<Result|null>(null);
  async function submit(){
    if(pending||!confirmed||!hevyId.trim())return;
    setPending(true);setResult(null);
    try{
      const response=await fetch("/api/strava/recover-pending",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({hevyId:hevyId.trim(),confirm:true})
      });
      const json=await response.json() as Result;
      setResult(response.ok?json:{mode:"error",reason:json.error??json.reason??"Falha na consulta"});
    }catch{setResult({mode:"error",reason:"Falha de comunicação; não repita o envio antes de verificar o histórico."});}
    finally{setPending(false);}
  }
  return <section className="rounded-xl border border-border bg-surface-elevated p-5 space-y-4">
    <h2 className="font-semibold">Recuperar treino pendente do Strava</h2>
    <p className="text-sm text-text-secondary">Somente treinos posteriores ao corte automático, já sincronizados com o Garmin. A recuperação usa a mesma verificação de duplicidade e o mesmo registro de envio da rotina diária. Não altera o Garmin.</p>
    <label className="block text-sm space-y-2">
      <span>ID do treino Hevy</span>
      <input className="w-full rounded border border-border bg-surface p-2" value={hevyId} onChange={e=>setHevyId(e.target.value)} placeholder="ID do treino Hevy" autoComplete="off"/>
    </label>
    <label className="flex gap-2 text-sm items-start">
      <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
      <span>Confirmei que esse treino ainda não aparece no Strava. Autorizo uma tentativa individual protegida, sem repetir um envio já registrado.</span>
    </label>
    <button type="button" disabled={!confirmed||!hevyId.trim()||pending} onClick={submit} className="rounded bg-teal/20 px-4 py-2 text-teal disabled:opacity-40">
      {pending?"Verificando…":"Verificar e recuperar este treino"}
    </button>
    {result&&<div role="status" className="rounded border border-border p-3 text-sm space-y-1">
      <p>Resultado: {result.mode??"desconhecido"}{result.status?` — ${result.status}`:""}</p>
      {result.reason&&<p>{result.reason}</p>}
      {result.uploadId&&<p>ID do envio: {result.uploadId}</p>}
      {result.activityId&&<p>ID da atividade Strava: {result.activityId}</p>}
      <p className="text-text-secondary">Se houver estado incerto, não repita o envio. Consulte o histórico antes.</p>
    </div>}
  </section>;
}
