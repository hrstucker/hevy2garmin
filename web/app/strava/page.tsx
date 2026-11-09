import Link from "next/link";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function StravaPage({ searchParams }: {
  searchParams: Promise<{ strava?: string }>;
}) {
  const { strava } = await searchParams;
  let connected = false;
  try {
    const sql = getDb();
    const rows = await sql`SELECT status FROM platform_credentials WHERE platform='strava' LIMIT 1`;
    connected = rows[0]?.status === "connected";
  } catch { /* The UI must not misrepresent an unavailable DB as success. */ }
  return <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Strava</h1>
      <p className="text-sm text-text-secondary">
        Envio independente de treinos consolidados Hevy + Garmin. O sincronismo
        Garmin existente não é alterado.
      </p>
    </div>
    <div className="rounded-xl border border-border bg-surface-elevated p-5 space-y-3">
      <div className="flex justify-between gap-3">
        <span className="font-medium">Conexão OAuth</span>
        <span className={connected?"text-teal":"text-text-secondary"}>
          {connected?"Conectado":"Não conectado"}
        </span>
      </div>
      {strava && <p className="text-xs text-text-secondary">Resultado da autorização: {strava}</p>}
      {!connected && <Link href="/api/strava/connect" className="text-teal underline">Conectar Strava</Link>}
      <div className="border-t border-border pt-3 space-y-1">
        <p className="font-medium">Envio automático: desativado</p>
        <p className="text-sm text-text-secondary">
          Nenhum upload ou alteração de atividades está habilitado nesta versão Preview.
          Primeiro vamos validar exercícios, FC, horários e arquivos gerados.
        </p>
      </div>
    </div>
    <div className="rounded-xl border border-border bg-surface-elevated p-5 space-y-2">
      <h2 className="font-semibold">Auditoria dos treinos Garmin</h2>
      <p className="text-sm text-text-secondary">
        Examine as fontes dos treinos concluídos e descubra quais exercícios e
        amostras de frequência cardíaca estão disponíveis para a exportação.
      </p>
      <Link href="/strava/workouts" className="inline-block text-teal underline">
        Ver treinos e auditar dados
      </Link>
    </div>
    <Link href="/settings" className="text-sm text-text-secondary underline">Configurações</Link>
  </main>;
}
