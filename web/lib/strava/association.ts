/** Only update a Strava record when a verified, explicit Garmin-to-Strava link exists. */
export interface StravaDetail {
  id: number;
  start_date: string;
  elapsed_time: number;
  device_name?: string | null;
  description?: string | null;
  name: string;
}
export function verifyGarminStravaLink(input: {
  candidate: StravaDetail;
  expectedStravaId: number;
  originalStartUtc: string;
  originalElapsedSeconds: number;
  maxTimeDriftSeconds?: number;
  maxDurationDriftSeconds?: number;
}): { ok: boolean; reason: string } {
  const { candidate, expectedStravaId, originalStartUtc, originalElapsedSeconds } = input;
  if (candidate.id !== expectedStravaId || !Number.isSafeInteger(candidate.id)) {
    return {ok:false,reason:"Strava ID mismatch"};
  }
  const start = Date.parse(candidate.start_date), expected = Date.parse(originalStartUtc);
  if (!Number.isFinite(start) || !Number.isFinite(expected) ||
      Math.abs(start - expected) > (input.maxTimeDriftSeconds ?? 60)*1000) {
    return {ok:false,reason:"Start timestamp mismatch"};
  }
  if (!Number.isFinite(candidate.elapsed_time) ||
      Math.abs(candidate.elapsed_time-originalElapsedSeconds) > (input.maxDurationDriftSeconds ?? 120)) {
    return {ok:false,reason:"Elapsed duration mismatch"};
  }
  // Do not guess the source from timing alone. Some activities from Hevy overlap exactly.
  if (!/garmin/i.test(candidate.device_name ?? "")) {
    return {ok:false,reason:"Garmin device source not verified"};
  }
  return {ok:true,reason:"Verified timestamp, duration, identity and Garmin source"};
}
