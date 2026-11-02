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

type Lookup = { status: number; activity?: ReturnType<typeof limited> };

function limited(a: Detail) {
  return {
    id: a.id, name: a.name, start_date: a.start_date ?? null,
    elapsed_time_seconds: a.elapsed_time ?? null,
    device_name: a.device_name ?? null,
    average_heartrate_bpm: a.average_heartrate ?? null,
    max_heartrate_bpm: a.max_heartrate ?? null,
    description_present: Boolean(a.description?.trim()),
    sport_type: a.sport_type ?? a.type ?? null,
  };
}
async function lookup(id: number, token: string): Promise<Lookup> {
  const res = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!res.ok) return { status: res.status };
  return { status: res.status, activity: limited(await res.json() as Detail) };
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
    const headers = { Authorization: `Bearer ${token}` };
    const [athleteRes, garmin, hevy] = await Promise.all([
      fetch("https://www.strava.com/api/v3/athlete", { headers, cache: "no-store" }),
      lookup(GARMIN_STRAVA_ID, token), lookup(HEVY_STRAVA_ID, token),
    ]);
    let athlete: { status: number; athlete_id?: number } = {status: athleteRes.status};
    if (athleteRes.ok) {
      const info = await athleteRes.json() as { id?: number };
      athlete = {status:athleteRes.status, athlete_id:info.id};
    }
    return NextResponse.json({
      mode: "read_only", changes_made:false, athlete, garmin, hevy,
      differences: garmin.activity && hevy.activity ? {
        start_seconds: garmin.activity.start_date && hevy.activity.start_date
          ? Math.abs(Date.parse(garmin.activity.start_date) - Date.parse(hevy.activity.start_date))/1000 : null,
        elapsed_seconds: typeof garmin.activity.elapsed_time_seconds === "number" && typeof hevy.activity.elapsed_time_seconds === "number"
          ? Math.abs(garmin.activity.elapsed_time_seconds - hevy.activity.elapsed_time_seconds) : null,
      } : null,
      interpretation: "A 404 may indicate a private, removed, or otherwise inaccessible activity. It does not prove deletion.",
    }, {headers: {"Cache-Control":"no-store"}});
  } catch {
    return NextResponse.json({error:"Read-only comparison failed"},{status:502});
  }
}
