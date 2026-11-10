/**
 * Read-only recovery of timestamped HR from the FINAL Garmin activity.
 * Uses garmin-auth's authenticated getBytes (incl. token refresh) and the
 * already installed official FIT SDK. Never uploads/merges/deletes Garmin data.
 */
import {inflateRawSync} from "node:zlib";
import {Decoder,Stream,Utils} from "@garmin/fitsdk";
import {getGarminClient} from "@/lib/garmin-upload";

export type GarminFitHrPoint={time:number;hr:number};
export interface GarminFinalFit {
  samples:GarminFitHrPoint[];
  calories:number|null;
  firstSampleUtc:string|null;
  lastSampleUtc:string|null;
}
const MAX_ZIP_BYTES=8*1024*1024;
const MAX_FIT_BYTES=16*1024*1024;
const FIT_EPOCH_MS=631065600000;

function u16(b:Uint8Array,i:number){return b[i]!+(b[i+1]!<<8);}
function u32(b:Uint8Array,i:number){return (b[i]!+(b[i+1]!<<8)+(b[i+2]!<<16)+(b[i+3]!*0x1000000))>>>0;}

/** Extract exactly one unencrypted .fit member from a ZIP central directory. */
export function fitFromGarminOriginal(bytes:Uint8Array):Uint8Array {
  if(bytes.byteLength<4)throw new Error("Garmin download is empty");
  // Some Garmin activities return an uncompressed FIT directly.
  if(bytes.length>=12 && bytes[8]===46 && bytes[9]===70 && bytes[10]===73 && bytes[11]===84)
    return bytes.length<=MAX_FIT_BYTES?bytes:(()=>{throw new Error("FIT too large")})();
  if(bytes.length>MAX_ZIP_BYTES)throw new Error("Garmin ZIP exceeds safety limit");
  // End-of-central-directory (ZIP comment <=65535), no ZIP64/multipart.
  let eocd=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-22-65535);i--){
    if(u32(bytes,i)===0x06054b50){eocd=i;break;}
  }
  if(eocd<0)throw new Error("Garmin download is not a valid ZIP/FIT");
  const count=u16(bytes,eocd+10),centralLength=u32(bytes,eocd+12),centralOffset=u32(bytes,eocd+16);
  if(count<1 || count>50 || centralOffset+centralLength>eocd)
    throw new Error("ZIP directory invalid");
  let at=centralOffset;
  let found:Uint8Array|null=null;
  for(let n=0;n<count;n++){
    if(at+46>bytes.length || u32(bytes,at)!==0x02014b50)throw new Error("Invalid ZIP entry");
    const flags=u16(bytes,at+8),method=u16(bytes,at+10);
    const compressed=u32(bytes,at+20),uncompressed=u32(bytes,at+24);
    const nameLength=u16(bytes,at+28),extra=u16(bytes,at+30),comment=u16(bytes,at+32);
    const localOffset=u32(bytes,at+42);
    if(at+46+nameLength+extra+comment>bytes.length)throw new Error("Invalid ZIP filename");
    const name=Buffer.from(bytes.subarray(at+46,at+46+nameLength)).toString("utf8");
    at+=46+nameLength+extra+comment;
    if(!/\.fit$/i.test(name) || name.includes("..") || name.startsWith("/"))continue;
    if(found)throw new Error("Multiple FIT members: cannot choose one safely");
    if(flags&1 || uncompressed>MAX_FIT_BYTES || compressed>MAX_ZIP_BYTES || uncompressed<1)
      throw new Error("Unsafe Garmin FIT ZIP member");
    if(localOffset+30>bytes.length || u32(bytes,localOffset)!==0x04034b50)
      throw new Error("Invalid ZIP local entry");
    const localName=u16(bytes,localOffset+26),localExtra=u16(bytes,localOffset+28);
    const dataOffset=localOffset+30+localName+localExtra;
    if(dataOffset+compressed>bytes.length)throw new Error("Truncated Garmin FIT ZIP");
    const data=bytes.subarray(dataOffset,dataOffset+compressed);
    const decoded=method===8?inflateRawSync(data,{maxOutputLength:MAX_FIT_BYTES}):
      method===0?Buffer.from(data):null;
    if(!decoded || decoded.length!==uncompressed)throw new Error("Unsupported/corrupt ZIP FIT");
    found=new Uint8Array(decoded);
  }
  if(!found)throw new Error("Original Garmin ZIP has no FIT activity");
  return found;
}

function timestampMs(value:unknown):number|null{
  if(value instanceof Date)return Number.isFinite(value.getTime())?value.getTime():null;
  if(typeof value==="string"){const ms=Date.parse(value);return Number.isFinite(ms)?ms:null;}
  if(typeof value==="number" && Number.isFinite(value)){
    if(value>1e12)return value; // UTC milliseconds
    if(value>1e9)return value*1000; // Unix seconds, future/past modern activity
    return value*1000+(Utils.FIT_EPOCH_MS??FIT_EPOCH_MS); // FIT epoch seconds
  }
  return null;
}
function obj(v:unknown):Record<string,unknown>{return v&&typeof v==="object"?v as Record<string,unknown>:{};}

/** Must be absolute activity timestamps; no synthesized/filled heart-rate points. */
export function decodeGarminFinalFit(
  fit:Uint8Array,workoutStartUtc:string,workoutEndUtc:string,
):GarminFinalFit{
  const start=Date.parse(workoutStartUtc),end=Date.parse(workoutEndUtc);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error("Invalid Hevy workout times");
  const stream=Stream.fromByteArray(Array.from(fit));
  const decoder=new Decoder(stream);
  if(!decoder.isFIT() || !decoder.checkIntegrity())throw new Error("FIT header/CRC invalid");
  const {messages,errors}=decoder.read({convertDateTimesToDates:true,mergeHeartRates:true});
  if(errors?.length)throw new Error("FIT decoder returned errors");
  const root=obj(messages);
  const records=Array.isArray(root.recordMesgs)?root.recordMesgs:[];
  const points:{absolute:number;hr:number}[]=[];
  let sourceHrCount=0;
  for(const raw of records){
    const r=obj(raw);
    const at=timestampMs(r.timestamp);
    const hr=r.heartRate;
    if(typeof hr==="number" && Number.isInteger(hr) && hr>=1 && hr<=255)sourceHrCount++;
    if(at===null || typeof hr!=="number" || !Number.isInteger(hr) || hr<1 || hr>255)continue;
    // Tight validation against Hevy time, not inferred from device time.
    if(at<start || at>end)continue;
    points.push({absolute:at,hr});
  }
  points.sort((a,b)=>a.absolute-b.absolute);
  const unique=points.filter((p,i)=>i===0 || p.absolute!==points[i-1].absolute);
  // A valid FIT with zero actual HR readings is a legitimate no-watch workout.
  // If HR exists outside the expected Hevy window or is too sparse, do not
  // mistakenly classify a time-alignment/quality failure as absence of HR.
  if(sourceHrCount>0 && unique.length<10)
    throw new Error("Garmin FIT has HR but insufficient aligned timestamped samples");
  const sessions=Array.isArray(root.sessionMesgs)?root.sessionMesgs:[];
  if(sourceHrCount===0 && !records.length && !sessions.length)
    throw new Error("Garmin FIT has no usable activity records or session");
  const session=sessions.length===1?obj(sessions[0]):{};
  const caloriesRaw=session.totalCalories;
  const calories=typeof caloriesRaw==="number" && Number.isInteger(caloriesRaw) &&
    caloriesRaw>=0 && caloriesRaw<10000?caloriesRaw:null;
  return {
    samples:unique.map(p=>({time:Number(((p.absolute-start)/1000).toFixed(3)),hr:p.hr})),
    calories,firstSampleUtc:unique.length?new Date(unique[0].absolute).toISOString():null,
    lastSampleUtc:unique.length?new Date(unique[unique.length-1].absolute).toISOString():null
  };
}

export async function fetchGarminFinalFit(
  garminActivityId:string,workoutStartUtc:string,workoutEndUtc:string,
):Promise<GarminFinalFit>{
  if(!/^\d{6,20}$/.test(garminActivityId))throw new Error("Invalid recorded Garmin activity ID");
  const client=await getGarminClient();
  const zip=await client.getBytes(`/download-service/files/activity/${garminActivityId}`);
  return decodeGarminFinalFit(fitFromGarminOriginal(zip),workoutStartUtc,workoutEndUtc);
}
