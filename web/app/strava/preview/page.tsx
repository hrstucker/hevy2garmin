import Link from "next/link";
import {createHash} from "node:crypto";
import {StravaUploadControl} from "@/components/strava-upload-control";
import { getDb } from "@/lib/db";
import { prepareConsolidatedExport } from "@/lib/strava/prepare-export";

export const dynamic = "force-dynamic";

export default async function StravaPreview({searchParams}: {
  searchParams:Promise<{hevyId?:string;utcOffsetSeconds?:string;recovery?:string}>;
}) {
  const params=await searchParams;
  const hevyId=params.hevyId??"";
  const offset=Number(params.utcOffsetSeconds??"NaN");
  const recovery=params.recovery??"";
  let report:Awaited<ReturnType<typeof prepareConsolidatedExport>>|null=null;
  let error="";
  try {
    report=await prepareConsolidatedExport(getDb(),hevyId,offset);
  }catch(e){error=e instanceof Error?e.message:"Não foi possível preparar a prévia";}
  const preview=report;
  const fingerprint=preview?.payload ? createHash("sha256").update(JSON.stringify(preview.payload)).digest("hex") : null;
  const uploadsEnabled=process.env.STRAVA_UPLOADS_ENABLED==="true" &&
    Boolean(process.env.STRAVA_FIRST_UPLOAD_UTC) &&
    process.env.STRAVA_ALLOWED_HEVY_ID===hevyId;
  const download= `/api/strava/preview-json?hevyId=${encodeURIComponent(hevyId)}&utcOffsetSeconds=${offset}&download=1`;
  return <main className="max-w-4xl mx-auto px-4 py-8 space-y-5">
    <Link href="/strava/workouts" className="text-teal text-sm">← Treinos Strava</Link>
    <div>
      <h1 className="text-2xl font-bold">Prévia do treino consolidado</h1>
      <p className="text-text-secondary text-sm mt-2">
        Esta tela não envia nem modifica atividades. É uma auditoria do arquivo
        Hevy + frequência cardíaca Garmin antes de qualquer upload.
      </p>
    </div>
    {error && <div className="rounded-xl border border-border p-4 text-red-400">
      Não foi possível gerar a prévia: {error}
    </div>}
    {preview && <>
      <div className="rounded-xl border border-border bg-surface-elevated p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{preview.name}</h2>
          <span className={preview.ready?"text-teal font-medium":"text-amber-400 font-medium"}>
            {preview.ready?"Arquivo pronto":"Dados pendentes"}
          </span>
        </div>
        <p className="text-xs text-text-secondary">Garmin: {preview.garminActivityId} ·
          {preview.recordedSetCount} séries Hevy · {preview.hrSamples} amostras de FC
          ({preview.hrSource})</p>
        <p className="text-xs text-text-secondary">
          Fuso declarado para exibição: UTC{preview.timezoneOffsetSeconds/3600>=0?"+":""}
          {preview.timezoneOffsetSeconds/3600}. Confirme o fuso real do treino.
        </p>
        {preview.payload && <p className="text-xs text-text-secondary">
          Início UTC: {preview.payload.start_time}; duração: {preview.payload.elapsed_time} s;
          séries exportadas: {preview.payload.sets.length}
        </p>}
        <div className="rounded-md border border-border p-3 mt-2 space-y-1">
          <p className="text-sm font-medium">Auditoria dos dados fisiológicos</p>
          <p className="text-xs text-text-secondary">
            Calorias no histórico local: {preview.caloriesFromSyncLedger ?? "indisponíveis"} kcal.
            Calorias no JSON: omitidas até confirmar o valor do Garmin consolidado.
          </p>
          {preview.hrEndingGapSeconds!==null && <p className="text-xs text-text-secondary">
            Intervalo sem amostras de FC ao final: {preview.hrEndingGapSeconds} segundos.
            Os pontos ausentes não são preenchidos artificialmente.
          </p>}
        </div>
        {preview.hrVerifiedAbsent && <p className="text-sm text-amber-400 font-medium">
          FIT final do Garmin auditado: sem medições reais de FC. O treino pode ser exportado sem FC, preservando séries e cargas.
        </p>}
        {recovery==="ok" && <p className="text-sm text-teal font-medium">
          FC da atividade final Garmin recuperada e armazenada.
        </p>}
        {recovery==="failed" && <p className="text-sm text-red-400">
          Não foi possível recuperar o FIT original automaticamente. Nenhuma atividade foi enviada.
        </p>}
        {preview.reasons.map(reason=><p key={reason} className="text-sm text-amber-400">{reason}</p>)}
        {!preview.ready && preview.hrSamples===0 && !preview.hrVerifiedAbsent && preview.garminActivityId && 
          <form action="/api/strava/recover-final-hr" method="post">
            <input type="hidden" name="hevyId" value={hevyId}/>
            <button type="submit" className="rounded-lg border border-teal px-3 py-2 text-sm text-teal">
              Recuperar FC da atividade final no Garmin
            </button>
            <p className="text-xs text-text-secondary mt-1">
              Consulta o FIT original e grava somente a FC no cache local.
              Não altera ou reenvia atividades Garmin/Strava.
            </p>
          </form>}
        {preview.caloriesFromGarminFinalFit!==null &&
          <p className="text-sm">Calorias confirmadas no FIT final Garmin:
            {" "}{preview.caloriesFromGarminFinalFit} kcal
          </p>}
        <Link href={`/strava/audit?hevyId=${encodeURIComponent(hevyId)}`}
          className="inline-block text-teal underline text-sm">
          Ver auditoria detalhada
        </Link>
        <p className="text-xs text-text-secondary">
          Links externos podem não enviar o cookie de sessão (SameSite=Strict).
          Para a auditoria autenticada, use este link interno.
        </p>
        {preview.ready ?
          <a className="inline-block text-teal underline text-sm" href={download}>
            Baixar arquivo JSON consolidado
          </a> :
          <Link href="/strava/mappings" className="inline-block text-teal underline text-sm">
            Revisar mapeamentos Strava
          </Link>}
      </div>
      <div className="rounded-xl border border-border bg-surface-elevated p-4">
        <h2 className="font-semibold mb-3">Exercícios e equivalências</h2>
        <div className="divide-y divide-border">
          {preview.exercises.map((exercise,index)=><div key={index}
            className="py-2 flex items-start justify-between gap-3">
            <div className="text-sm">{exercise.title}
              <span className="text-text-secondary"> · {exercise.sets} séries</span>
            </div>
            <div className={exercise.mappedTo?"text-teal text-xs":"text-amber-400 text-xs"}>
              {exercise.mappedTo??"Não mapeado"}
            </div>
          </div>)}
        </div>
      </div>
      {preview.ready && fingerprint && <StravaUploadControl
        hevyId={hevyId} utcOffsetSeconds={offset} fingerprint={fingerprint}
        enabled={uploadsEnabled}/>} 
    </>}
  </main>;
}
