import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, authEnabled, SESSION_COOKIE } from "@/lib/auth";
import { getStravaAccessToken } from "@/lib/strava/authenticated-client";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only preview: no changes to Strava or Garmin.
 * Requires explicit Hevy and Strava IDs to prevent accidental cross-matching.
 */
export async function POST(request: Request) {
  if (!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { hevyId?: string; stravaActivityId?: number };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const id = body.stravaActivityId;
  const hevyId = body.hevyId;
  if (typeof hevyId !== "string" || !hevyId || !Number.isSafeInteger(id) || (id ?? 0) <= 0) {
    return NextResponse.json({ error: "Specify Hevy ID and Strava activity ID" }, { status: 400 });
  }
  try {
    const sql = getDb();
    const workouts = await sql`SELECT hevy_id, title, garmin_activity_id, status
      FROM synced_workouts WHERE hevy_id=${hevyId} LIMIT 1`;
    if (!workouts[0]?.garmin_activity_id || workouts[0]?.status !== "success") {
      return NextResponse.json({ error: "No successfully synchronized Garmin workout found" }, { status: 409 });
    }
    const token = await getStravaAccessToken();
    const response = await fetch(`https://www.strava.com/api/v3/activities/${id}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (!response.ok) return NextResponse.json({ error: "Strava lookup failed", status: response.status }, { status: 502 });
    const activity = await response.json() as { id: number; name: string; description?: string; device_name?: string; start_date?: string };
    return NextResponse.json({
      dryRun: true,
      garminActivityId: workouts[0].garmin_activity_id,
      hevyWorkoutId: hevyId,
      proposedTitle: workouts[0].title,
      currentStrava: {
        id: activity.id, name: activity.name,
        description: activity.description ?? "", device_name: activity.device_name ?? null,
        start_date: activity.start_date ?? null,
      },
      note: "No write was performed; origin and start-time verification required before automatic updates.",
    });
  } catch {
    return NextResponse.json({ error: "Preview unavailable; check connection and application logs" }, { status: 503 });
  }
}
