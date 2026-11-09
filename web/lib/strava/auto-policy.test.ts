import {describe,expect,it} from "vitest";
import {autoStravaConfig,eligibleAutoStravaWorkout} from "./auto-policy";

describe("automatic Strava synchronization guardrails",()=>{
  const cutoff="2026-11-10T03:00:00Z";
  const at=Date.parse("2026-11-11T03:00:00Z");
  const eligible={
    cutoff,nowMs:at,
    startTime:"2026-11-10T23:00:00Z",
    syncedAt:"2026-11-10T23:15:00Z"
  };

  it("is disabled by default, even if manual uploads are enabled",()=>{
    expect(autoStravaConfig({STRAVA_UPLOADS_ENABLED:"true"} as NodeJS.ProcessEnv).enabled).toBe(false);
  });
  it("refuses to enable without an explicit UTC cutoff",()=>{
    expect(autoStravaConfig({
      STRAVA_AUTO_SYNC_ENABLED:"true",STRAVA_UPLOADS_ENABLED:"true"
    } as NodeJS.ProcessEnv).error).toMatch(/STRAVA_AUTO_START_UTC/);
  });
  it("refuses to enable without the global upload flag",()=>{
    expect(autoStravaConfig({
      STRAVA_AUTO_SYNC_ENABLED:"true",STRAVA_AUTO_START_UTC:cutoff
    } as NodeJS.ProcessEnv).enabled).toBe(false);
  });
  it("allows only sufficiently settled post-cutoff workouts",()=>{
    expect(eligibleAutoStravaWorkout(eligible)).toBe(true);
    expect(eligibleAutoStravaWorkout({...eligible,startTime:"2026-11-09T22:00:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,syncedAt:"2026-11-09T23:00:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,
      syncedAt:"2026-11-11T02:50:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,
      syncedAt:"2026-11-11T04:00:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...eligible,startTime:"not-a-time"})).toBe(false);
  });
});
