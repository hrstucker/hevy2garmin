import { describe, expect, it } from "vitest";
import { verifyGarminStravaLink } from "./association";

const good = {
 candidate: {id:20785963871,name:"Musculação ao entardecer",start_date:"2026-10-29T23:50:00Z",elapsed_time:5518,device_name:"Garmin Forerunner 245"},
 expectedStravaId:20785963871,
 originalStartUtc:"2026-10-29T23:50:00Z",
 originalElapsedSeconds:5518,
};
describe("Strava association guards",()=>{
 it("accepts exact Garmin identity",()=>expect(verifyGarminStravaLink(good).ok).toBe(true));
 it("rejects another ID",()=>expect(verifyGarminStravaLink({...good,expectedStravaId:20785981962}).ok).toBe(false));
 it("rejects missing source",()=>expect(verifyGarminStravaLink({...good,candidate:{...good.candidate,device_name:null}}).ok).toBe(false));
 it("rejects Hevy source",()=>expect(verifyGarminStravaLink({...good,candidate:{...good.candidate,device_name:"Hevy"}}).ok).toBe(false));
 it("rejects shifted start",()=>expect(verifyGarminStravaLink({...good,candidate:{...good.candidate,start_date:"2026-10-29T23:55:00Z"}}).ok).toBe(false));
 it("rejects changed elapsed duration",()=>expect(verifyGarminStravaLink({...good,candidate:{...good.candidate,elapsed_time:5800}}).ok).toBe(false));
});
