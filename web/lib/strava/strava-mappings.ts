/**
 * Values verified against https://developers.strava.com/docs/uploads/
 * "JSON - Strength Training (Limited)" as of 2026-11-09.
 *
 * Suggestions are NOT automatic approvals. User must explicitly save every mapping.
 * Generic substitution must be disclosed, and treadmill walking must NOT be
 * silently transformed into RUNNING.
 */
export const VERIFIED_STRAVA_EXERCISES = [
  "CARDIO_GENERIC", "RUNNING", "MACHINE_CHEST_FLY", "PEC_DECK_BUTTERFLY",
  "LAT_PULLDOWN", "MACHINE_GLUTE_KICKBACK", "MACHINE_LEG_PRESS",
  "LATERAL_RAISE_GENERIC", "MACHINE_BICEP_CURL", "MACHINE_TRICEP_EXTENSION",
  "AB_CRUNCH_MACHINE", "MACHINE_BACK_EXTENSION", "TIBIALIS_RAISE",
  "PALLOF_PRESS", "WARM_UP_GENERIC", "BENCH_PRESS_GENERIC", "MACHINE_CHEST_PRESS",
  "MACHINE_SEATED_ROW", "SEATED_CABLE_ROW", "CABLE_CRUNCH",
  "PLANK_GENERIC", "MACHINE_LEG_EXTENSION", "MACHINE_LEG_CURL_SEATED",
  "MACHINE_HIP_ABDUCTION", "MACHINE_HIP_ADDUCTION", "DUMBBELL_HAMMER_CURL",
  "CABLE_BICEPS_CURL", "TRICEPS_PRESSDOWN", "CABLE_TRICEPS_PUSHDOWN",
  "SEATED_DUMBBELL_SHOULDER_PRESS", "CALF_RAISE_GENERIC",
  "STANDING_CALF_RAISE", "SEATED_CALF_RAISE", "LEG_PRESS", "SQUAT_GENERIC",
  "ROWING_MACHINE", "ASSAULT_BIKE", "CABLE_CORE_PRESS", "MACHINE_SEATED_SHOULDER_PRESS",
  "CABLE_LAT_PULLDOWN_CLOSE_GRIP", "CABLE_KICKBACK", "CABLE_LATERAL_RAISE",
  "MACHINE_ISOLATERAL_HIGH_ROW", "MACHINE_HIP_THRUST", "CABLE_HAMMER_CURL",
  "MACHINE_REAR_DELT_REVERSE_FLY", "SEATED_DIP_MACHINE", "LEG_CURL_GENERIC",
] as const;

const verified = new Set<string>(VERIFIED_STRAVA_EXERCISES);
export function supportedStravaType(type: unknown): type is string {
  return typeof type === "string" && verified.has(type);
}
export const SUGGESTED_HEVY_STRAVA_MAP: Record<string,string> = {
  "Bicicleta Horizontal":"CARDIO_GENERIC",
  "Crucifixo (Máquina)":"MACHINE_CHEST_FLY",
  "Tração Vertical (Máquina)":"LAT_PULLDOWN",
  "Coice de Glúteo (Máquina)":"MACHINE_GLUTE_KICKBACK",
  "Leg Press Horizontal (Máquina)":"MACHINE_LEG_PRESS",
  "Elevação Lateral (Máquina)":"LATERAL_RAISE_GENERIC",
  "Rosca Direta (Máquina)":"MACHINE_BICEP_CURL",
  "Extensão de Tríceps Sentado (Máquina)":"MACHINE_TRICEP_EXTENSION",
  "Abdominal (Máquina)":"AB_CRUNCH_MACHINE",
  "Extensão Lombar (Máquina)":"MACHINE_BACK_EXTENSION",
  "Tibial Anterior na Polia":"TIBIALIS_RAISE",
  "Crucifixo Invertido (Máquina)":"MACHINE_REAR_DELT_REVERSE_FLY",
  "Mergulho Sentado (Máquina)":"SEATED_DIP_MACHINE",
  "Mesa Flexora (Máquina)":"LEG_CURL_GENERIC",
  // "Esteira" is intentionally NOT suggested: could be walking or running.
  "Palof Press (Cabo)":"PALLOF_PRESS",
  "Pallof Press":"PALLOF_PRESS",
};
export const MAPPING_CAVEATS: Record<string,string> = {
  "Bicicleta Horizontal":"Genérico: Strava não distingue bicicleta horizontal nesse catálogo.",
  "Mesa Flexora (Máquina)":"LEG_CURL_GENERIC preserva a flexão do joelho, mas não identifica que a máquina é deitada.",
  "Elevação Lateral (Máquina)":"Genérico: não identifica especificamente a máquina.",
  "Esteira":"Confirme se foi corrida ou caminhada. Não escolher RUNNING para caminhada.",
  "Tração Vertical (Máquina)":"LAT_PULLDOWN pressupõe uma puxada vertical; confirme a execução.",
  "Extensão de Tríceps Sentado (Máquina)":"MACHINE_TRICEP_EXTENSION pressupõe extensão, não mergulho sentado.",
};
