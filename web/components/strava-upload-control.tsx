"use client";
import {useState} from "react";
import {withBasePath} from "@/lib/base-path";

export function StravaUploadControl({hevyId,utcOffsetSeconds,fingerprint,enabled}:{
  hevyId:string;utcOffsetSeconds:number;fingerprint:string;enabled:boolean;
}) {
  const [confirmed,setConfirmed]=useState(false);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState("");
  const [uploadId,setUploadId]=useState<string|null>(null);
  async function submit(){
    if(!enabled || !confirmed || loading)return;
    setLoading(true);
    setMessage("");
    try {
      const r=await fetch(withBasePath("/api/strava/submit-json"),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          hevyId,utcOffsetSeconds,expectedSha256:fingerprint,
          confirmation:`UPLOAD:${hevyId}`,
        }),
      });
      const data=await r.json() as {error?:string;uploadId?:string;status?:string};
      if(!r.ok) throw new Error(data.error??"Falha no upload");
      setUploadId(data.uploadId??null);
      setMessage("Arquivo recebido pelo Strava. A atividade ainda precisa ser processada.");
    }catch(e){setMessage(e instanceof Error?e.message:"Erro de envio");}
    finally{setLoading(false);}
  }
  async function refresh(){
    if(!uploadId || loading)return;
    setLoading(true);
    try{
      const r=await fetch(withBasePath("/api/strava/check-upload"),{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({hevyId}),
      });
      const data=await r.json() as {status?:string;error?:string;stravaActivityId?:string};
      if(!r.ok) throw new Error(data.error??"Falha na verificação");
      setMessage(data.stravaActivityId
        ? `Processamento concluído. Atividade Strava: ${data.stravaActivityId}`
        : data.error??`Processamento: ${data.status??"indefinido"}`);
    }catch(e){setMessage(e instanceof Error?e.message:"Erro de verificação");}
    finally{setLoading(false);}
  }
  return <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-3">
    <h2 className="font-semibold">Envio individual ao Strava</h2>
    {!enabled && <p className="text-sm text-text-secondary">
      Ainda desativado para segurança. A prévia e o download acima funcionam sem envio.
    </p>}
    <label className="flex gap-2 items-start text-sm">
      <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}
        disabled={!enabled || Boolean(uploadId)} />
      <span>Confirmei exercícios, horários, frequência cardíaca e que esse treino ainda
        não foi publicado no Strava. Entendo que uma importação pode ser irreversível.</span>
    </label>
    <div className="flex gap-2 flex-wrap">
      <button type="button" disabled={!enabled || !confirmed || loading || Boolean(uploadId)}
        onClick={()=>void submit()}
        className="border border-border rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-40">
        {loading?"Processando…":"Enviar este treino uma vez"}
      </button>
      {uploadId && <button type="button" onClick={()=>void refresh()}
        disabled={loading} className="border border-border rounded-lg px-4 py-2 text-sm">
        Verificar processamento
      </button>}
    </div>
    {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
  </div>;
}
