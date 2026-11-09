import Link from "next/link";
import { getDb } from "@/lib/db";
import { autoStravaConfig } from "@/lib/strava/auto-policy";

export const dynamic = "force-dynamic";

export default async function StravaPage({ searchParams }: {
  searchParams: Promise<{ strava?: string }>;
}) {
  const { strava } = await searchParams;
  let connected = false;
  const auto = autoStravaConfig(process.env);
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
        <p className="font-medium">Envio automático: {auto.enabled?"habilitado por configuração":"desativado"}</p>
        <p className="text-sm text-text-secondary">
          {auto.enabled
            ? "Somente treinos que comecem e sejam sincronizados com o Garmin após a data de corte são elegíveis. A execução agendada da Vercel funciona em produção, não em Preview."
            : "Nenhum envio automático ocorre sem ativação explícita. Treinos históricos não são importados automaticamente."}
        </p>
        {auto.cutoff && <p className="text-sm text-text-secondary">
          Data de corte UTC: {auto.cutoff}
        </p>}
        {auto.error && <p className="text-sm text-red-400">
          Configuração inválida: {auto.error}
        </p>}
        <p className="text-xs text-text-secondary">
          Agendamento previsto: 11:00 UTC (08:00 São Paulo), diariamente. O envio manual individual tem autorização separada.
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
    <div className="rounded-xl border border-border bg-surface-elevated p-5 space-y-2">
      <h2 className="font-semibold">Mapeamento de exercícios</h2>
      <p className="text-sm text-text-secondary">
        Escolha equivalências explícitas entre os exercícios do Hevy e o catálogo
        do Strava. O mapeamento Garmin permanece independente.
      </p>
      <Link href="/strava/mappings" className="inline-block text-teal underline">
        Revisar e salvar mapeamentos Strava
      </Link>
    </div>
    <Link href="/settings" className="text-sm text-text-secondary underline">Configurações</Link>
  </main>;
}
