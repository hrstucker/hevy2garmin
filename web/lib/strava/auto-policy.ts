/**
 * Pure policy for unattended post-Garmin-completion Strava submissions.
 * Opt-in only. No historical backfill. All comparisons use UTC timestamps.
 */
export function autoStravaConfig(env:NodeJS.ProcessEnv):{
  enabled:boolean;cutoff:string|null;error:string|null
}{
  if(env.STRAVA_AUTO_SYNC_ENABLED!=="true")return {enabled:false,cutoff:null,error:null};
  const cutoff=env.STRAVA_AUTO_START_UTC??"";
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(cutoff) ||
      !Number.isFinite(Date.parse(cutoff)))
    return {enabled:false,cutoff:null,error:"STRAVA_AUTO_START_UTC must be a valid explicit UTC date (Z)"};
  if(env.STRAVA_UPLOADS_ENABLED!=="true")
    return {enabled:false,cutoff,error:"STRAVA_UPLOADS_ENABLED must also be true"};
  return {enabled:true,cutoff,error:null};
}
export function eligibleAutoStravaWorkout(input:{
  startTime:string; syncedAt:string; cutoff:string; nowMs:number;
}):boolean{
  const start=Date.parse(input.startTime),synced=Date.parse(input.syncedAt);
  const cutoff=Date.parse(input.cutoff);
  return [start,synced,cutoff,input.nowMs].every(Number.isFinite) &&
    start>=cutoff && synced>=cutoff && start<=input.nowMs &&
    synced<=input.nowMs - 15*60*1000; // allow merge and HR backup to finish
}
