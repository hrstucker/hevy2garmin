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
  } catch {
    // Show disconnected on DB errors; OAuth callback reports actual errors.
  }
  return <main style={{ maxWidth: 680, margin: "3rem auto", padding: 24 }}>
    <h1>Strava — Hevy2Garmin</h1>
    <p>Estado: <strong>{connected ? "Conectado" : "Não conectado"}</strong></p>
    {strava && <p>Resultado da autorização: {strava}</p>}
    <p>Esta conexão permite atualizar o nome e a descrição de uma atividade Garmin já existente no Strava.
      Não publica novos arquivos FIT e não exclui atividades.</p>
    <p><a href="/api/strava/connect">Conectar Strava</a></p>
    <p>A publicação automática permanece desativada enquanto a associação
      segura entre as atividades Garmin e Strava não for validada.</p>
    <Link href="/settings">Voltar às configurações</Link>
  </main>;
}
