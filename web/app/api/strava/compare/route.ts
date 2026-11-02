import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { authEnabled, verifySession, SESSION_COOKIE } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { getSessionEpoch } from "@/lib/session-epoch";
import { getStravaAccessToken } from "@/lib/strava/authenticated-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A fixed, previously identified pair. This endpoint never updates or deletes workouts.
const GARMIN_STRAVA_ID = 20785963871;
const HEVY_STRAVA_ID = 20785981962;

type Detail = {
  id: number; name: string; start_date?: string; elapsed_time?: number;
  device_name?: string | null; average_heartrate?: number | null;
  max_heartrate?: number | null; description?: string | null;
  type?: string; sport_type?: string;
};

async function getActivity(id: number, token: string): Promise<Detail> {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!res.ok) throw new Error(`Strava returned HTTP ${res.status} for activity ${id}`);
  return await res.json() as Detail;
}

export async function GET() {
  const jar = await cookies();
  let authorized = false;
  try {
    if (authEnabled()) {
      const sql = getDb();
      authorized = await verifySession(jar.get(SESSION_COOKIE)?.value ?? null, await getSessionEpoch(sql));
    }
  } catch { authorized = false; }
  if (!authorized) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const token = await getStravaAccessToken();
    const [garmin, hevy] = await Promise.all([
      getActivity(GARMIN_STRAVA_ID, token), getActivity(HEVY_STRAVA_ID, token),
    ]);
    const limited = (a: Detail) => ({
      id: a.id, name: a.name, start_date: a.start_date ?? null,
      elapsed_time_seconds: a.elapsed_time ?? null,
      device_name: a.device_name ?? null,
      average_heartrate_bpm: a.average_heartrate ?? null,
      max_heartrate_bpm: a.max_heartrate ?? null,
      description_present: Boolean(a.description?.trim()),
      sport_type: a.sport_type ?? a.type ?? null,
    });
    return NextResponse.json({
      mode: "read_only", changes_made: false,
      garmin: limited(garmin), hevy: limited(hevy),
      differences: {
        start_seconds: garmin.start_date && hevy.start_date
          ? Math.abs(Date.parse(garmin.start_date) - Date.parse(hevy.start_date)) / 1000 : null,
        elapsed_seconds: Number.isFinite(garmin.elapsed_time) && Number.isFinite(hevy.elapsed_time)
          ? Math.abs((garmin.elapsed_time as number) - (hevy.elapsed_time as number)) : null,
      },
      warning: "Matching start and duration alone does not prove source; no activities were changed.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error && /^Strava returned HTTP \d{3}/.test(error.message)
      ? error.message : "Strava read-only comparison failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
