/**
 * Strava's documented WeightTraining JSON 1.0.
 * Strict about mappings and source timestamps: never invent exercise identity,
 * heart-rate samples, weight, duration, or workout timezone.
 * https://developers.strava.com/docs/uploads/
 */
import { supportedStravaType } from "./strava-mappings";

export interface SourceSet {
  reps?: number | null;
  weight_kg?: number | null;
  duration_seconds?: number | null;
  start_time?: string | null;
  type?: string | null;
}
export interface SourceExercise { title: string; sets: SourceSet[] }
export interface HrSample { time: number; hr: number }
export interface StrengthInput {
  startTime: string;
  endTime: string;
  utcOffsetSeconds: number;
  exercises: SourceExercise[];
  exerciseTypes: Record<string, string>;
  hrSamples: HrSample[];
  calories?: number | null;
}
export interface StravaSet {
  exercise_type: string;
  repetitions?: number;
  weight?: number;
  duration?: number;
  start_time?: string;
}
export interface StravaStrengthJson {
  version: "1.0";
  start_time: string;
  utc_offset: number;
  elapsed_time: number;
  total_calories?: number;
  creator: { name: string };
  sets: StravaSet[];
  streams?: { time: number[]; heartrate: number[] };
}
const isFiniteNonnegative = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= 0;
function validateDate(s: string): string {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(s)
      || !Number.isFinite(Date.parse(s))) {
    throw new Error("Workout/set timestamps must be ISO 8601 with timezone");
  }
  return new Date(s).toISOString();
}
export function buildStrengthJson(input: StrengthInput): StravaStrengthJson {
  const start = validateDate(input.startTime);
  const end = validateDate(input.endTime);
  const elapsed = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  if (!Number.isSafeInteger(elapsed) || elapsed <= 0 || elapsed > 24 * 3600)
    throw new Error("Invalid workout duration");
  if (!Number.isInteger(input.utcOffsetSeconds) ||
      Math.abs(input.utcOffsetSeconds) > 14 * 3600)
    throw new Error("Explicit UTC offset required");
  if (!Array.isArray(input.exercises) || input.exercises.length === 0)
    throw new Error("Missing Hevy exercises");
  const outputSets: StravaSet[] = [];
  const missing = new Set<string>();
  for (const exercise of input.exercises) {
    if (!exercise || typeof exercise.title !== "string" ||
        !Array.isArray(exercise.sets)) throw new Error("Invalid Hevy exercise");
    const stravaType = input.exerciseTypes[exercise.title];
    if (!supportedStravaType(stravaType)) {
      missing.add(exercise.title || "(unnamed exercise)");
      continue;
    }
    for (const item of exercise.sets) {
      if (!item) throw new Error("Invalid exercise set");
      // Include all recorded working, warmup and drop sets except explicitly
      // invalid/skipped sets. Do not transform set weights or repetitions.
      const set: StravaSet = { exercise_type: stravaType };
      if (item.reps != null) {
        if (!Number.isSafeInteger(item.reps) || item.reps < 0) throw new Error("Invalid repetitions");
        set.repetitions = item.reps;
      }
      if (item.weight_kg != null) {
        if (!isFiniteNonnegative(item.weight_kg)) throw new Error("Invalid weight");
        set.weight = item.weight_kg;
      }
      if (item.duration_seconds != null) {
        if (!Number.isSafeInteger(item.duration_seconds) || item.duration_seconds < 0)
          throw new Error("Invalid set duration");
        set.duration = item.duration_seconds;
      }
      if (item.start_time) {
        const stamp = validateDate(item.start_time);
        if (Date.parse(stamp) < Date.parse(start) ||
            Date.parse(stamp) > Date.parse(end)) throw new Error("Set outside workout window");
        set.start_time = stamp;
      }
      if (!("repetitions" in set) && !("duration" in set))
        throw new Error("Set has neither repetitions nor duration");
      outputSets.push(set);
    }
  }
  if (missing.size) throw new Error("Unmapped Strava exercises: " + [...missing].join(", "));
  if (!outputSets.length) throw new Error("No valid sets");
  if (!Array.isArray(input.hrSamples))
    throw new Error("Invalid heart-rate sample collection");
  const sorted = [...input.hrSamples].sort((a,b)=>a.time-b.time);
  const time: number[] = [], heartrate: number[] = [];
  for (const sample of sorted) {
    if (!Number.isSafeInteger(sample.time) || sample.time < 0 || sample.time > elapsed ||
        !Number.isInteger(sample.hr) || sample.hr <= 0 || sample.hr >= 256)
      throw new Error("Invalid timestamped heart-rate point");
    if (time.at(-1) === sample.time) throw new Error("Duplicate HR sample second");
    time.push(sample.time); heartrate.push(sample.hr);
  }
  const doc: StravaStrengthJson = {
    version: "1.0", start_time:start, utc_offset:input.utcOffsetSeconds,
    elapsed_time:elapsed, creator:{name:"Hevy2Garmin"},
    sets: outputSets,
    ...(time.length ? {streams:{time,heartrate}} : {}),
  };
  if (input.calories != null) {
    if (!Number.isSafeInteger(input.calories) || input.calories < 0)
      throw new Error("Invalid calorie count");
    doc.total_calories=input.calories;
  }
  return doc;
}
