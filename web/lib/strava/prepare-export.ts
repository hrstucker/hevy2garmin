/**
 * Read-only consolidation shared by JSON preview and future guarded upload.
 * Does not call Strava, write Garmin, or mutate Hevy.
 */
import { getDb } from "@/lib/db";
import { fetchAllWorkouts, type HevyWorkout } from "@/lib/hevy-sync";
import { cachedHr, loadHrBackup } from "@/lib/hr-store";
import { buildStrengthJson, type SourceExercise, type StravaStrengthJson } from "./strength-json";
import { loadStravaMappings } from "./mapping-store";
import {recoverAndCacheFinalGarminHr} from "./garmin-final-recovery";

export interface ConsolidatedPreview {
  mode:"read_only";
  changes_made:false;
  ready:boolean;
  hevyId:string;
  garminActivityId:string;
  name:string;
  exercises:{title:string;sets:number;mappedTo:string|null}[];
  unmappedExercises:string[];
  recordedSetCount:number;
  hrSamples:number;
  hrSource:"cache"|"backup"|"unavailable";
  hrVerifiedAbsent:boolean;
  hrLastSampleSecond:number|null;
  hrEndingGapSeconds:number|null;
  caloriesFromSyncLedger:number|null;
  caloriesExported:false;
  caloriesFromGarminFinalFit:number|null;
  timezoneOffsetSeconds:number;
  reasons:string[];
  payload:StravaStrengthJson|null;
}

function validNumber(value:unknown,name:string):number|undefined {
  if (value===null || value===undefined) return undefined;
  if (typeof value!=="number" || !Number.isFinite(value)) throw new Error(`Invalid Hevy ${name}`);
  return value;
}
export function extractSourceExercises(workout:HevyWorkout):SourceExercise[] {
  if (!Array.isArray(workout.exercises) || !workout.exercises.length)
    throw new Error("Hevy exercise list unavailable");
  return workout.exercises.map((raw,index)=>{
    if(!raw || typeof raw!=="object") throw new Error(`Invalid Hevy exercise ${index+1}`);
    const e=raw as Record<string,unknown>;
    const title=e.title;
    if(typeof title!=="string" || !title.trim() || !Array.isArray(e.sets))
      throw new Error(`Incomplete Hevy exercise ${index+1}`);
    return {title,sets:e.sets.map((rawSet,setIndex)=>{
      if(!rawSet || typeof rawSet!=="object")
        throw new Error(`Invalid set ${setIndex+1} of ${title}`);
      const set=rawSet as Record<string,unknown>;
      const reps=validNumber(set.reps,"reps");
      const weight=validNumber(set.weight_kg,"weight");
      const duration=validNumber(set.duration_seconds,"duration");
      return {
        reps,weight_kg:weight,duration_seconds:duration,
        type:typeof set.type==="string"?set.type:null,
        // Never synthesize set-level start times.
      };
    })};
  });
}

export async function prepareConsolidatedExport(
  sql:ReturnType<typeof getDb>,hevyId:string,utcOffsetSeconds:number,
  options:{recoverMissingHrFromGarmin?:boolean}={},
):Promise<ConsolidatedPreview> {
  if(!hevyId || hevyId.length>120 || !Number.isInteger(utcOffsetSeconds) ||
    Math.abs(utcOffsetSeconds)>50400 || utcOffsetSeconds%60!==0)
    throw new Error("Valid Hevy ID and explicit UTC offset are required");

  const records=await sql`SELECT hevy_id,status,garmin_activity_id,calories,title
    FROM synced_workouts WHERE hevy_id=${hevyId} LIMIT 1`;
  const sync=records[0];
  if(!sync || sync.status!=="success" || !sync.garmin_activity_id)
    throw new Error("No completed Garmin synchronization for this workout");

  const workouts=await fetchAllWorkouts();
  const workout=workouts.find((w:HevyWorkout)=>w.id===hevyId);
  if(!workout) throw new Error("Workout not found in Hevy");

  const exercises=extractSourceExercises(workout);
  const mappings=await loadStravaMappings(sql);
  const unmapped=[...new Set(exercises.map(e=>e.title).filter(t=>!mappings[t]))];
  let cached=await cachedHr(sql,hevyId);
  let backedUp=await loadHrBackup(sql,{
    id:hevyId,start_time:workout.start_time,end_time:workout.end_time,
  });
  // Only a successfully inspected final Garmin FIT can confirm no HR.
  const finalFitKey="garmin_final_fit_"+hevyId;
  const readFinalFit=async()=>{
    const rows=await sql`SELECT value FROM app_cache
      WHERE key=${finalFitKey} LIMIT 1`;
    const raw=rows[0]?.value;
    return raw && typeof raw==="object" ? raw as Record<string,unknown> : null;
  };
  let finalFit=await readFinalFit();
  const confirmedNoHr=()=>finalFit?.source==="garmin_final_fit" &&
    finalFit?.garminActivityId===String(sync.garmin_activity_id) &&
    finalFit?.samples===0;
  if(!cached?.length && !backedUp?.length &&
     !confirmedNoHr() && options.recoverMissingHrFromGarmin){
    // Failed downloads/parses stop an upload, never masquerade as no HR.
    await recoverAndCacheFinalGarminHr(sql,{
      hevyId,garminActivityId:String(sync.garmin_activity_id),workout
    });
    cached=await cachedHr(sql,hevyId);
    backedUp=await loadHrBackup(sql,{
      id:hevyId,start_time:workout.start_time,end_time:workout.end_time
    });
    finalFit=await readFinalFit();
  }
  const verifiedCalories=finalFit?.garminActivityId===String(sync.garmin_activity_id) &&
    typeof finalFit.calories==="number" &&
    Number.isFinite(finalFit.calories)?finalFit.calories:null;
  // Preserve the denser original Garmin timeline when both caches exist.
  const fromBackup=(backedUp?.length??0)>(cached?.length??0);
  const samples=fromBackup?backedUp:cached;
  const hrSource= samples?.length ? (fromBackup?"backup":"cache") : "unavailable";
  const reasons:string[]=[];
  if(unmapped.length) reasons.push("Some Hevy exercises have no confirmed Strava mapping");
  // A manually uploaded watch FIT is an independently verified source, not
  // proof that the Garmin Connect consolidated FIT contained no HR.
  const manualRows=await sql`SELECT value FROM app_cache
    WHERE key=${"manual_watch_fit_"+hevyId} LIMIT 1`;
  const manualRaw=manualRows[0]?.value;
  const manual=manualRaw && typeof manualRaw==="object"?
    manualRaw as Record<string,unknown>:null;
  const manualAbsent=manual?.source==="manual_watch_fit" &&
    manual?.hevyId===hevyId &&
    manual?.garminActivityId===String(sync.garmin_activity_id) &&
    manual?.samples===0 && typeof manual?.sha256==="string" &&
    /^[a-f0-9]{64}$/.test(manual.sha256) &&
    typeof manual?.fitStartUtc==="string" &&
    Math.abs(Date.parse(manual.fitStartUtc)-Date.parse(workout.start_time??""))<=600000;
  const hrVerifiedAbsent=!samples?.length && (confirmedNoHr() || manualAbsent);
  if(!samples?.length && !hrVerifiedAbsent)
    reasons.push("Garmin heart-rate source not yet verified; run recovery before export");

  const base:ConsolidatedPreview={
    mode:"read_only",changes_made:false,ready:false,hevyId,
    garminActivityId:String(sync.garmin_activity_id),
    name:typeof workout.title==="string"?workout.title:String(sync.title??"Treino"),
    exercises:exercises.map(e=>({title:e.title,sets:e.sets.length,mappedTo:mappings[e.title]??null})),
    unmappedExercises:unmapped,
    recordedSetCount:exercises.reduce((total,e)=>total+e.sets.length,0),
    hrSamples:samples?.length??0,hrSource,hrVerifiedAbsent,timezoneOffsetSeconds:utcOffsetSeconds,
    hrLastSampleSecond:samples?.length?Math.max(...samples.map(s=>s.time)):null,
    hrEndingGapSeconds:null,
    caloriesFromSyncLedger:typeof sync.calories==="number"?sync.calories:null,
    caloriesExported:false,caloriesFromGarminFinalFit:verifiedCalories,
    reasons,payload:null,
  };
  if(reasons.length)return base;
  const payload=buildStrengthJson({
    startTime:workout.start_time??"",
    endTime:workout.end_time??"",
    utcOffsetSeconds,exercises,exerciseTypes:mappings,
    hrSamples:samples??[],
    // Database ledger calories are not independently verified as the final Garmin
    // activity total. Omit instead of attributing an uncertain number to Garmin.
    calories:null,
  });
  const lastSample=base.hrLastSampleSecond;
  return {...base,ready:true,payload,
    hrEndingGapSeconds:lastSample===null?null:payload.elapsed_time-lastSample};
}
