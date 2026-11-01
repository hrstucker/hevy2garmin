import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, authEnabled, SESSION_COOKIE } from "@/lib/auth";
import { getStravaAccessToken } from "@/lib/strava/authenticated-client";
import { verifyGarminStravaLink } from "@/lib/strava/association";
import { updateStravaActivityMetadata } from "@/lib/strava/activity-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit, single-activity write endpoint. Disabled by default. Never imports,
 * deletes or uploads a new activity. Its caller must provide Garmin-origin
 * start time/duration verified independently of the Strava activity.
 */
export async function POST(request: Request) {
  if (process.env.STRAVA_UPDATES_ENABLED !== "true") {
    return NextResponse.json({ error: "Strava updates are disabled" }, {status: 403});
  }
  if (!authEnabled() || !await verifySession((await cookies()).get(SESSION_COOKIE)?.value ?? null)) {
    return NextResponse.json({ error: "Unauthorized" }, {status: 401});
  }
  const origin = new URL(request.url).origin;
  if (request.headers.get("origin") !== origin) {
    return NextResponse.json({ error: "Origin check failed" }, {status:403});
  }
  let input: {
    stravaActivityId: number; originalStartUtc: string; originalElapsedSeconds: number;
    name: string; description: string; confirmation?: string;
  };
  try { input = await request.json(); }
  catch { return NextResponse.json({error:"Invalid request"}, {status:400}); }
  if (!Number.isSafeInteger(input.stravaActivityId) || input.stravaActivityId<=0 ||
    !Number.isFinite(input.originalElapsedSeconds) || input.originalElapsedSeconds<=0 ||
    typeof input.originalStartUtc !== "string" ||
    typeof input.name !== "string" || typeof input.description !== "string" ||
    input.name.length>250 || input.description.length>10000 ||
    input.confirmation !== `UPDATE:${input.stravaActivityId}`) {
      return NextResponse.json({error:"Missing valid fields and explicit activity confirmation"},{status:400});
  }
  try {
    const token=await getStravaAccessToken();
    const response=await fetch(`https://www.strava.com/api/v3/activities/${input.stravaActivityId}`,{
      headers:{Authorization:`Bearer ${token}`},cache:"no-store",
    });
    if(!response.ok) return NextResponse.json({error:"Strava activity lookup failed"},{status:502});
    const candidate=await response.json();
    const verified=verifyGarminStravaLink({
      candidate,expectedStravaId:input.stravaActivityId,
      originalStartUtc:input.originalStartUtc,
      originalElapsedSeconds:input.originalElapsedSeconds,
    });
    if(!verified.ok) return NextResponse.json({error:verified.reason},{status:409});
    // Prevent an old user-created description from silently disappearing.
    if (candidate.description && candidate.description.trim() &&
        !candidate.description.includes("synced by hevy2garmin")) {
      return NextResponse.json({error:"Activity has an existing description; refusing overwrite"},{status:409});
    }
    await updateStravaActivityMetadata({
      accessToken:token,stravaActivityId:input.stravaActivityId,
      name:input.name,description:input.description,
    });
    return NextResponse.json({updated:true,stravaActivityId:input.stravaActivityId});
  }catch {
    return NextResponse.json({error:"Strava update failed"},{status:502});
  }
}
