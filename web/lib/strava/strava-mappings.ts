/**
 * Deliberately small, reviewed vocabulary from Strava's published JSON
 * WeightTraining exercise enum. A syntactically valid unknown enum is NOT safe.
 * https://developers.strava.com/docs/uploads/#json---strength-training-limited
 *
 * The mapping from a Hevy title to one of these values requires its own
 * explicit decision. A biomechanically similar exercise is not automatically
 * considered equivalent.
 */
export const VERIFIED_STRAVA_EXERCISES = [
  "PALLOF_PRESS", "TIBIALIS_RAISE", "CARDIO_GENERIC", "RUNNING",
  "ROWING_MACHINE", "ASSAULT_BIKE", "CABLE_CORE_PRESS", "CABLE_CRUNCH",
  "PLANK_GENERIC", "BENCH_PRESS_GENERIC", "MACHINE_CHEST_PRESS",
  "SEATED_CABLE_ROW", "MACHINE_SEATED_ROW", "LAT_PULLDOWN",
  "CABLE_LAT_PULLDOWN_CLOSE_GRIP", "MACHINE_LEG_PRESS",
  "MACHINE_LEG_EXTENSION", "MACHINE_LEG_CURL_SEATED",
  "MACHINE_HIP_ABDUCTION", "MACHINE_HIP_ADDUCTION",
  "DUMBBELL_HAMMER_CURL", "CABLE_BICEPS_CURL", "CABLE_TRICEPS_PUSHDOWN",
  "TRICEPS_PRESSDOWN", "SEATED_DUMBBELL_SHOULDER_PRESS",
  "CALF_RAISE_GENERIC", "STANDING_CALF_RAISE", "SEATED_CALF_RAISE",
  "LEG_PRESS", "SQUAT_GENERIC", "WARM_UP_GENERIC",
] as const;
const verified = new Set<string>(VERIFIED_STRAVA_EXERCISES);
export function supportedStravaType(type: unknown): type is string {
  return typeof type === "string" && verified.has(type);
}
/** Only exact user-confirmed equivalences, no generic automatic fallback. */
export const APPROVED_HEVY_STRAVA_MAP: Record<string,string> = {
  "Palof Press (Cabo)": "PALLOF_PRESS",
  "Pallof Press": "PALLOF_PRESS",
  "Tibial Anterior na Polia": "TIBIALIS_RAISE",
};
