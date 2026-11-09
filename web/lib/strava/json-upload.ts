/**
 * Strava JSON upload primitives only; there is intentionally no HTTP route,
 * timer, cron, automatic retry or call site that performs a live upload.
 * https://developers.strava.com/docs/uploads/
 *
 * Uploads are asynchronous and must be tracked durably by the caller before
 * ever enabling this function. A transport timeout is ambiguous: DO NOT retry
 * until the existing upload can be reconciled, or a duplicate may be created.
 */
import type { StravaStrengthJson } from "./strength-json";
export type UploadReceipt = {
  id: string; external_id: string | null;
  status: string; error: string | null; activity_id: string | null;
};

function safeId(value: unknown): string | null {
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}
function receipt(raw: unknown): UploadReceipt {
  const data = raw as Record<string,unknown>;
  const id = safeId(data.id_str) ?? safeId(data.id);
  if (!id) throw new Error("Strava upload returned no valid ID");
  return {
    id, external_id: typeof data.external_id === "string" ? data.external_id : null,
    status: typeof data.status === "string" ? data.status : "",
    error: typeof data.error === "string" ? data.error : null,
    activity_id: safeId(data.activity_id),
  };
}
export async function submitStrengthJson(input: {
  accessToken: string; hevyWorkoutId: string; workout: StravaStrengthJson;
  name: string; description: string;
}): Promise<UploadReceipt> {
  if (!input.accessToken || !input.hevyWorkoutId || !input.name.trim())
    throw new Error("Missing upload identity");
  const form = new FormData();
  form.append("data_type","json");
  form.append("sport_type","WeightTraining");
  form.append("name",input.name);
  form.append("description",input.description);
  form.append("external_id",`hevy2garmin-strava-${input.hevyWorkoutId}-v1`);
  form.append("file",new Blob([JSON.stringify(input.workout)],{type:"application/json"}),
    `hevy2garmin-${input.hevyWorkoutId}.json`);
  const response = await fetch("https://www.strava.com/api/v3/uploads",{
    method:"POST",headers:{Authorization:`Bearer ${input.accessToken}`},
    body:form,cache:"no-store",
  });
  if (response.status!==201) throw new Error(`Strava upload HTTP ${response.status}`);
  return receipt(await response.json());
}
export async function getUploadStatus(accessToken:string,uploadId:string):Promise<UploadReceipt>{
  if (!/^\d+$/.test(uploadId)) throw new Error("Invalid upload ID");
  const response = await fetch(`https://www.strava.com/api/v3/uploads/${uploadId}`,{
    headers:{Authorization:`Bearer ${accessToken}`},cache:"no-store",
  });
  if (!response.ok) throw new Error(`Strava upload status HTTP ${response.status}`);
  return receipt(await response.json());
}
