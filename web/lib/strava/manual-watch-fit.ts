/**
 * Manual watch FIT inspection. We require an independently encoded activity start
 * before attributing any physiological samples to a Hevy workout.
 */
import {Decoder,Stream,Utils} from "@garmin/fitsdk";
import {createHash} from "node:crypto";
import {decodeGarminFinalFit} from "./garmin-final-fit";

const FIT_EPOCH_MS=631065600000;
const MAX_FIT_BYTES=16*1024*1024;
function atMs(value:unknown):number|null{
  if(value instanceof Date)return Number.isFinite(value.getTime())?value.getTime():null;
  if(typeof value==="string"){const x=Date.parse(value);return Number.isFinite(x)?x:null;}
  if(typeof value==="number" && Number.isFinite(value)){
    if(value>1e12)return value;
    if(value>1e9)return value*1000;
    return value*1000+(Utils.FIT_EPOCH_MS??FIT_EPOCH_MS);
  }
  return null;
}
function object(v:unknown):Record<string,unknown>{
  return v && typeof v==="object" ? v as Record<string,unknown> : {};
}
/** Window comparison is purely about identity, never a method for fabricating FC. */
export function assertFitStartMatches(
  fitStartMs:number|null,hevyStart:string,toleranceMs=10*60*1000
):void{
  const target=Date.parse(hevyStart);
  if(!Number.isFinite(target)||fitStartMs===null||!Number.isFinite(fitStartMs))
    throw new Error("Missing valid activity start: cannot identify FIT");
  if(Math.abs(fitStartMs-target)>toleranceMs)
    throw new Error("FIT activity start does not match the selected Hevy workout");
}

export function inspectManualWatchFit(
  bytes:Uint8Array,workoutStart:string,workoutEnd:string
){
  if(bytes.byteLength<14||bytes.byteLength>MAX_FIT_BYTES)
    throw new Error("FIT file size is invalid or exceeds 16 MiB");
  if(String.fromCharCode(...bytes.subarray(8,12))!==".FIT")
    throw new Error("File does not have a FIT header");
  const decoder=new Decoder(Stream.fromByteArray(Array.from(bytes)));
  if(!decoder.isFIT()||!decoder.checkIntegrity())
    throw new Error("FIT integrity or CRC check failed");
  const parsed=decoder.read({convertDateTimesToDates:true,mergeHeartRates:true});
  if(parsed.errors?.length)throw new Error("FIT decoder reported errors");
  const root=object(parsed.messages);
  const sessions=Array.isArray(root.sessionMesgs)?root.sessionMesgs:[];
  if(sessions.length!==1)
    throw new Error("FIT must contain exactly one activity session");
  const session=object(sessions[0]);
  const records=Array.isArray(root.recordMesgs)?root.recordMesgs:[];
  const recordTimes=records.map((record)=>atMs(object(record).timestamp))
    .filter((time):time is number=>time!==null);
  const start=atMs(session.startTime)??(recordTimes.length?Math.min(...recordTimes):null);
  assertFitStartMatches(start,workoutStart);
  // A recorded HR stream outside the Hevy window is an alignment failure,
  // not evidence that a watch was absent.
  const extracted=decodeGarminFinalFit(bytes,workoutStart,workoutEnd);
  return {...extracted,
    fitStartUtc:new Date(start!).toISOString(),
    sha256:createHash("sha256").update(bytes).digest("hex")
  };
}
