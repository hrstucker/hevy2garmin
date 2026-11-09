import {describe,expect,it} from "vitest";
import {autoStravaConfig,eligibleAutoStravaWorkout} from "./auto-policy";

describe("Unattended Strava export gate",()=>{
  it("defaults to disabled even if previous one-time uploads are enabled",()=>{
    expect(autoStravaConfig({STRAVA_UPLOADS_ENABLED:"true"})).toEqual({
      enabled:false,cutoff:null,error:null
    });
  });
  it("requires a UTC cutoff and both independent switches",()=>{
    expect(autoStravaConfig({STRAVA_AUTO_SYNC_ENABLED:"true"}).error).toMatch(/UTC/);
    expect(autoStravaConfig({STRAVA_AUTO_SYNC_ENABLED:"true",
      STRAVA_AUTO_START_UTC:"2026-11-10T00:00:00Z"}).error).toMatch(/STRAVA_UPLOADS_ENABLED/);
    expect(autoStravaConfig({STRAVA_AUTO_SYNC_ENABLED:"true",
      STRAVA_UPLOADS_ENABLED:"true",
      STRAVA_AUTO_START_UTC:"2026-11-10T00:00:00Z"}).enabled).toBe(true);
  });
  it("requires workout AND Garmin synchronization after the cutoff",()=>{
    const nowMs=Date.parse("2026-11-11T12:00:00Z");
    const valid={
      startTime:"2026-11-11T06:00:00Z",syncedAt:"2026-11-11T07:00:00Z",
      cutoff:"2026-11-10T00:00:00Z",nowMs
    };
    expect(eligibleAutoStravaWorkout(valid)).toBe(true);
    expect(eligibleAutoStravaWorkout({...valid,startTime:"2026-10-29T23:50:40Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...valid,syncedAt:"2026-11-09T23:59:59Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...valid,syncedAt:"2026-11-11T11:55:00Z"})).toBe(false);
    expect(eligibleAutoStravaWorkout({...valid,startTime:"bad"})).toBe(false);
  });
});
