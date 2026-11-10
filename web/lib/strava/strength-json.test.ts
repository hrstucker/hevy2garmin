import { describe, expect, it } from "vitest";
import {buildStrengthJson, type StrengthInput} from "./strength-json";
const example: StrengthInput = {
  startTime:"2026-10-29T20:50:00-03:00",
  endTime:"2026-10-29T22:29:10-03:00",
  utcOffsetSeconds:-10800,
  exercises:[{title:"Pallof Press", sets:[{reps:12,weight_kg:5}]}],
  exerciseTypes:{"Pallof Press":"PALLOF_PRESS"},
  hrSamples:[{time:0,hr:90},{time:10,hr:99}],
  calories:503,
};
describe("Strava strength JSON",()=>{
 it("preserves measured inputs and time zones",()=>{
   const out=buildStrengthJson(example);
   expect(out.version).toBe("1.0");
   expect(out.start_time).toBe("2026-10-29T23:50:00.000Z");
   expect(out.elapsed_time).toBe(5950);
   expect(out.sets[0]).toEqual({exercise_type:"PALLOF_PRESS",repetitions:12,weight:5});
   expect(out.streams).toEqual({time:[0,10],heartrate:[90,99]});
   expect(out.total_calories).toBe(503);
 });
 it("rejects unmapped exercises",()=>expect(()=>buildStrengthJson({...example,exerciseTypes:{}})).toThrow("Unmapped"));
 it("keeps measured sets when HR is verified absent and omits optional streams",()=>{
   const out=buildStrengthJson({...example,hrSamples:[]});
   expect(out.sets).toHaveLength(1);
   expect(out).not.toHaveProperty("streams");
   expect(out.elapsed_time).toBe(5950);
 });
 it("rejects invalid HR collection",()=>expect(()=>buildStrengthJson({...example,hrSamples:null as unknown as StrengthInput["hrSamples"]})).toThrow("heart-rate"));
 it("rejects invalid time offsets",()=>expect(()=>buildStrengthJson({...example,utcOffsetSeconds:999999})).toThrow("offset"));
 it("rejects dates without timezone",()=>expect(()=>buildStrengthJson({...example,startTime:"2026-10-29T20:50:00"})).toThrow("timezone"));
 it("rejects HR timestamps beyond the duration",()=>expect(()=>buildStrengthJson({...example,hrSamples:[{time:6000,hr:99}]})).toThrow("heart-rate"));
});
