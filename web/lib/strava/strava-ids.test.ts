import {describe,it,expect} from "vitest";
import {exactStravaId} from "./activity-client";
import {safeId} from "./json-upload";

describe("Strava 64-bit identifiers",()=>{
  it("prefers id_str even when JSON numeric id has lost precision",()=>{
    expect(exactStravaId(9007199254740992,"9223372036854775807")).toBe("9223372036854775807");
  });
  it("rejects unsafe numeric ids without a string alternative",()=>{
    expect(exactStravaId(9007199254740992)).toBeNull();
    expect(safeId(9007199254740992)).toBeNull();
  });
  it("accepts safe legacy numbers and exact digit strings",()=>{
    expect(exactStravaId(12345)).toBe("12345");
    expect(exactStravaId("9223372036854775807")).toBe("9223372036854775807");
    expect(safeId("9223372036854775807")).toBe("9223372036854775807");
  });
  it("rejects malformed or nonpositive identifiers",()=>{
    expect(exactStravaId(0)).toBeNull();
    expect(exactStravaId("12e4")).toBeNull();
    expect(exactStravaId(-5)).toBeNull();
  });
});
