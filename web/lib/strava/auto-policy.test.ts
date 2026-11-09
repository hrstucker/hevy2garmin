import {describe,expect,it} from "vitest";
import {autoStravaConfig,eligibleAutoStravaWorkout} from "./auto-policy";

function testEnv(values:Record<string,string>):NodeJS.ProcessEnv {
  return {...process.env,
    STRAVA_AUTO_SYNC_ENABLED:undefined,
    STRAVA_UPLOADS_ENABLED:undefined,
    STRAVA_AUTO_START_UTC:undefined,
    ...values};
}

describe("automatic Strava synchronization guardrails",()=>{
  const cutoff="2026-11-10T03:00:00Z";
  const nowMs=Date.parse("2026-11-11T03:00:00Z");
  const eligible={
    cutoff,nowMs,
    startTime:"2026-11-10T23:00:00Z",
    syncedAt:"2026-11-10T23:15:00Z"
  };

  it("defaults to disabled even with manual uploads enabled",()=>{
    expect(autoStravaConfig(testEnv({STRAVA_UPLOADS_ENABLED:"true"})).enabled).toBe(false);
  });
  it("rejects missing/invalid UTC start cutoff",()=>{
    expect(autoStravaConfig(testEnv({
      STRAVA_AUTO_SYNC_ENABLED:"true",STRAVA_UPLOADS_ENABLED:"true"
    })).error).toMatch(/STRAVA_AUTO_START_UTC/);
    expect(autoStravaConfig(testEnv({
      STRAVA_AUTO_SYNC_ENABLED:"true",STRAVA_UPLOADS_ENABLED:"true",
      STRAVA_AUTO_START_UTC:"2026-11-10T03:00:00-03:00"
    })).enabled).toBe(false);
  });
  it("requires global uploads switch",()=>{
    expect(autoStravaConfig(testEnv({
      STRAVA_AUTO_SYNC_ENABLED:"true",STRAVA_AUTO_START_UTC:cutoff
    })).enabled).toBe(false);
  });
  it("accepts valid guarded configuration",()=>{
    expect(autoStravaConfig(testEnv({
      STRAVA_AUTO_SYNC_ENABLED:"true",STRAVA_UPLOADS_ENABLED:"true",
      STRAVA_AUTO_START_UTC:cutoff
    }))).toEqual({enabled:true,cutoff,error:null});
  });
  it("only selects fully post-cutoff synchronized workouts",()=>{
    expect(eligibleAutoStravaWorkout(eligible)).toBe(true);
    expect(eligibleAutoStravaWorkout({...eligible,startTime:"2026-11-09T22:00:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,syncedAt:"2026-11-09T23:00:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,syncedAt:"2026-11-11T02:50:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,syncedAt:"2026-11-11T04:00:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,startTime:"invalid"})).toBe(false);
  });
});
