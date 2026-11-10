import {describe,it,expect} from "vitest";
import {assertFitStartMatches} from "./manual-watch-fit";

describe("manual watch FIT identity",()=>{
  const start="2026-10-18T22:27:46.000Z";
  it("accepts an exact match",()=>{
    expect(()=>assertFitStartMatches(Date.parse(start),start)).not.toThrow();
  });
  it("accepts device clock drift only within ten minutes",()=>{
    expect(()=>assertFitStartMatches(Date.parse(start)+599999,start)).not.toThrow();
    expect(()=>assertFitStartMatches(Date.parse(start)+600001,start)).toThrow(/does not match/);
  });
  it("rejects a different day's FIT even when renamed",()=>{
    expect(()=>assertFitStartMatches(Date.parse("2026-10-13T23:25:00Z"),start))
      .toThrow(/does not match/);
  });
  it("requires a reliable activity start from the FIT itself",()=>{
    expect(()=>assertFitStartMatches(null,start)).toThrow(/Missing valid/);
    expect(()=>assertFitStartMatches(NaN,start)).toThrow(/Missing valid/);
  });
});
