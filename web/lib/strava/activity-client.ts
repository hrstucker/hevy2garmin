/**
 * Strava API primitives for a post-merge metadata sync.
 *
 * This module NEVER creates/uploads Strava activities or deletes records.
 * OAuth secrets and refresh tokens must remain server-side.
 * Hook into the verified Garmin merge completion only after the user explicitly enables Strava.
 */
const API = "https://www.strava.com/api/v3";

export interface StravaActivityCandidate {
  id: number;
  start_date: string;
  elapsed_time: number;
  name: string;
  device_name?: string | null;
  sport_type?: string | null;
}

interface StravaTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

async function requireOk(response: Response, operation: string): Promise<void> {
  if (!response.ok) {
    // Do not log response bodies: they can contain account information.
    throw new Error(`Strava ${operation} failed (HTTP ${response.status})`);
  }
}

export async function refreshStravaAccessToken(input: {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<StravaTokenResponse> {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  await requireOk(response, "OAuth refresh");
  const value = (await response.json()) as StravaTokenResponse;
  if (!value.access_token || !value.refresh_token || !value.expires_at) {
    throw new Error("Invalid Strava OAuth refresh response");
  }
  return value;
}

export async function listStravaActivities(input: {
  accessToken: string;
  after: number;
  before: number;
}): Promise<StravaActivityCandidate[]> {
  const url = new URL(`${API}/athlete/activities`);
  url.searchParams.set("after", String(input.after));
  url.searchParams.set("before", String(input.before));
  url.searchParams.set("per_page", "100");
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    cache: "no-store",
  });
  await requireOk(response, "activity lookup");
  return (await response.json()) as StravaActivityCandidate[];
}

/**
 * A zero/ambiguous match must never be auto-selected.
 * The caller should also check that the matched record is from Garmin, not Hevy,
 * before updating it, because Strava's list endpoint may omit device details.
 */
export function matchByStartAndDuration(
  activities: StravaActivityCandidate[],
  expected: { startTimeUtcMs: number; elapsedSeconds: number },
  toleranceSeconds = 120,
): StravaActivityCandidate | null {
  const matches = activities.filter((activity) => {
    const startMs = Date.parse(activity.start_date);
    return Number.isFinite(startMs) &&
      Math.abs(startMs - expected.startTimeUtcMs) <= toleranceSeconds * 1000 &&
      Math.abs(activity.elapsed_time - expected.elapsedSeconds) <= toleranceSeconds;
  });
  return matches.length === 1 ? matches[0] : null;
}

export async function updateStravaActivityMetadata(input: {
  accessToken: string;
  stravaActivityId: number;
  name: string;
  description: string;
}): Promise<void> {
  if (!Number.isSafeInteger(input.stravaActivityId) || input.stravaActivityId <= 0) {
    throw new Error("Invalid Strava activity ID");
  }
  if (!input.name.trim() || !input.description.trim()) {
    throw new Error("Strava name and description cannot be empty");
  }
  const response = await fetch(`${API}/activities/${input.stravaActivityId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: input.name, description: input.description }),
    cache: "no-store",
  });
  await requireOk(response, "activity metadata update");
}

/**
 * Conservative duplicate preflight for a new Hevy strength upload.
 * Time alone is not an identity; the check intentionally errs toward blocking
 * any nearby strength session until an operator reconciles it. It does not
 * mutate the Strava activity, and cannot eliminate races with Garmin sync.
 */
export function findPossibleStrengthDuplicates(
  activities:StravaActivityCandidate[],startTime:string,toleranceSeconds=600,
):StravaActivityCandidate[] {
  const target=Date.parse(startTime);
  if(!Number.isFinite(target))throw new Error("Invalid expected start time");
  const strengthTypes=new Set(["WeightTraining","Workout","Crossfit","HighIntensityIntervalTraining"]);
  return activities.filter(a=>{
    const actual=Date.parse(a.start_date);
    return Number.isFinite(actual) && Math.abs(actual-target)<=toleranceSeconds*1000 &&
      (strengthTypes.has(a.sport_type??"") || (a.sport_type==null && /treino|workout|muscula|strength/i.test(a.name)));
  });
}
