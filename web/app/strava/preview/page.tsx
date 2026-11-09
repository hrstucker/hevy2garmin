import Link from "next/link";
import { getDb } from "@/lib/db";
import { prepareConsolidatedExport } from "@/lib/strava/prepare-export";

export const dynamic = "force-dynamic";

export default async function StravaPreview({searchParams}: {
  searchParams:Promise<{hevyId?:string;utcOffsetSeconds?:string}>;
}) {
  const params=await searchParams;
  const hevyId=params.hevyId??"";
  const offset=Number(params.utcOffsetSeconds??"NaN");
  let report:Awaited<ReturnType<typeof prepareConsolidatedExport>>|null=null;
  let error="";
  try {
    report=await prepareConsolidatedExport(getDb(),hevyId,offset);
  }catch(e){error=e instanceof Error?e.message:"Não foi possível preparar a prévia";}
  const preview=report;
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
        {preview.reasons.map(reason=><p key={reason} className="text-sm text-amber-400">{reason}</p>)}
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
    </>}
  </main>;
}
