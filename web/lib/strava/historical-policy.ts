/** Historical Strava imports are explicitly requested, never cron-driven.
 * The release cutoff is a protection boundary, not a backfill scheduler.
 */
export const HISTORICAL_CUTOFF_UTC="2026-11-10T18:00:00.000Z";

export function historicalWorkoutEligible(start:string,cutoff=HISTORICAL_CUTOFF_UTC):boolean{
  const time=Date.parse(start),boundary=Date.parse(cutoff);
  return Number.isFinite(time)&&Number.isFinite(boundary)&&time<boundary;
}

export function historicalUploadConfirmation(hevyId:string):string{
  return `HISTORICAL-UPLOAD:${hevyId}`;
}
