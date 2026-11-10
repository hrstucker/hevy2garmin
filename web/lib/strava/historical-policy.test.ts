import {describe,expect,it} from "vitest";
import {historicalWorkoutEligible,historicalUploadConfirmation,HISTORICAL_CUTOFF_UTC} from "./historical-policy";

describe("historical import guard",()=>{
  it("excludes all sessions at or after the automatic sync cutoff",()=>{
    expect(HISTORICAL_CUTOFF_UTC).toBe("2026-11-10T18:00:00.000Z");
    expect(historicalWorkoutEligible("2026-11-10T17:59:59.000Z")).toBe(true);
    expect(historicalWorkoutEligible("2026-11-10T18:00:00.000Z")).toBe(false);
    expect(historicalWorkoutEligible("2026-11-11T11:00:00.000Z")).toBe(false);
  });
  it("fails closed on missing timestamps",()=>{
    expect(historicalWorkoutEligible("")).toBe(false);
    expect(historicalWorkoutEligible("not-a-date")).toBe(false);
  });
  it("requires explicit identity-bound approval",()=>{
    expect(historicalUploadConfirmation("abc")).toBe("HISTORICAL-UPLOAD:abc");
  });
});
