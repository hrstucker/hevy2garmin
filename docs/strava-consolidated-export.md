# Consolidated Hevy → Garmin → Strava: implementation plan

## Non-negotiable invariants
- Existing Hevy → Garmin merge path remains unchanged.
- Hevy → Strava and Garmin → Strava direct sync are currently disabled by the owner.
- Only a **single consolidated activity** may be uploaded for each Hevy workout.
- No automatic deletion of historical Strava activities.
- No fabricated timestamps, exercise mappings, calories or heart-rate readings.
- Strava failures never block or rerun Garmin synchronisation.

## Validated format
Strava Uploads documentation now supports `data_type=json` for `WeightTraining`
with `version:1.0`, `start_time`, `utc_offset`, `elapsed_time`,
`sets[exercise_type,...]` and `streams[time,heartrate]`.
See https://developers.strava.com/docs/uploads/
Its exercise names are an enumerated list, NOT free-form Hevy names.

## Completed in branch
- OAuth and encrypted credential storage; connected via Preview.
- `strength-json.ts` pure builder with strict source and time validation.
- `strength-json.test.ts` unit cases.
- `json-upload.ts` contains **dormant** upload and status functions.
- Main navigation entry and /strava/workouts source audit.
- No automatic or user-accessible upload call site.
- User-editable Strava mappings, per-workout source auditing, JSON preview and download.
- Independent durable strava_uploads schema and dormant submission-state helpers.

## Next gates
1. Confirm Vercel Preview build and tests (currently not verified).
2. Run read-only source audit for one completed workout and inspect **actual**
   Hevy exercise/set fields and timestamped Garmin HR source.
3. Create user-editable explicit Hevy-to-Strava exercise mapping. Compare each
   target value against Strava's published exercise enum; do not silently
   substitute generics. Map timed cardio only where supported.
4. Generate JSON preview with unmapped exercise report and source provenance.
   Provide file download for manual validation before write.
5. Add durable `strava_uploads` database ledger with a unique Hevy workout ID,
   state machine (prepared/submitting/submitted/processing/ready/failed/unknown),
   stable external_id, upload_id and activity_id. A request timeout is an
   ambiguous outcome; **no blind retry**.
6. Add a single-action confirmed upload, guarded by feature flag, origin/CSRF
   and authenticated session. Poll upload status without excess API calls.
7. Inspect the resulting Strava activity for named sets and retained HR graph.
   If JSON is insufficient, compare with FIT based on the actual outcome.
8. Add a durable async trigger after Garmin Merge, include idempotency and
   asynchronous retries that cannot impact Garmin success.
9. Polish mobile navigation (many tabs), show statuses, preview/download,
   retry, errors and link to Strava. Test 2-3 workouts before production.
10. Restore previous behavior by leaving Strava feature disabled if validation
    fails. Never ask the user to manually reenable automatic direct uploads
    without checking duplicate risk first.

## Operational note
Preview and Production have distinct STRAVA_CALLBACK_ORIGIN. Both may share
a database depending on Neon configuration: read/write boundaries must be
explicit even in Preview. No credentials or tokens in the repository.

## Validated first live test (2026-11-09)

- Hevy workout 288bae08-5152-4aab-b1db-6de9e710ad90, Garmin 24922545131, Strava 20921447664: JSON strength upload accepted and fully processed.
- Strava displayed all 12 exercises / 32 sets / 300 reps / 15,470 kg and HR graph (99 bpm mean, 127 bpm max). Do not automatically resubmit this activity.
- Hevy elapsed time 5950 s, final real HR time 5513 s; Strava displays approximately 5513 s, a 437-second gap. No synthetic HR samples should be created; document elapsed separately until a truthful format remedy is tested.
- The local synced_workouts calories value (834 kcal) was removed from the JSON because its provenance is not confirmed against the final Garmin recording.

## Critical routing decision: cycling vs strength training

Garmin Connect → Strava native sync uploads **all compatible Garmin activities**, not just rides. The documented Garmin permission is for "Activities", not an exercise-specific switch:
https://support.strava.com/en-us/articles/15401903-garmin-and-strava

When native Garmin → Strava is disabled, Garmin-only rides do not reach Strava via the Hevy-driven export. The Hevy2Garmin Strava writer should NOT be considered a replacement for Garmin-only uploads until a separate Garmin-only activity path exists.

Restoring native Garmin → Strava would automatically send rides, but may also upload strength training before our structured exporter: duplicates may result. The public Strava PUT /activities/{id} updates metadata (name, description, sport type, etc), not the structured sets/streams. Do not plan on upgrading an already imported Garmin Strava activity by PUT-ing sets:
https://developers.strava.com/docs/reference/

### Safe architecture options

1. **Recommended future direction:** Garmin-only activities (rides, other non-Hevy sports) go through a separately implemented Garmin → Strava path, while Hevy-sourced strength workouts use the proven JSON pipeline. Keep native Garmin → Strava disconnected until that path is implemented and tested. Requires obtaining real Garmin activity source files or data, with duplicate reconciliation and no alteration of the original Garmin source.
2. Short-term alternative: restore native Garmin → Strava, **disable Hevy2Garmin automatic Strava writes**, and accept that some Garmin-synced strength activities may not contain the same Hevy structured sets, or manually reconcile on a per-activity basis. The app's new preflight detects many existing nearby strength activities and blocks new JSON submissions, but cannot prevent upstream Garmin races or replace those existing sets.
3. Manually upload rides on Strava while developing option 1, keeping native sync off.

### Protections

- Durable strava_uploads ledger prevents a second Hevy upload when its first upload exists.
- Before any FUTURE live JSON strength upload, query Strava's recent activities around the workout's start and fail closed if a matching strength-like activity already exists. This is read-only, conservative, and **not a guarantee** against concurrent Garmin sync.
- No automatic Garmin → Strava connection changes, no deletion/update of imported Strava activities, and no automatic Strava scheduling until mixed-source behavior is implemented and tested.

## Automatic post-Garmin reconciliation — opt-in (2026-11-09)

The branch adds a separate **read-only Garmin ledger -> Strava** reconciliation worker:
- `GET /api/cron/strava` requires Bearer `CRON_SECRET`; Vercel invokes it at **11:00 UTC every day** (08:00 São Paulo), only on the deployment where crons are active (production on Vercel).
- First check a single `submitted/processing` Strava upload; poll and mark its final state.
- Otherwise inspect the oldest completed Garmin sync **after** an explicit cutoff; require both the original Hevy workout and its Garmin sync timestamp to be newer than the cutoff and a 15-minute minimum since Garmin completion.
- Reuse the same Hevy sets, Strava mappings and preserved Garmin FC samples as preview. Do not export unverified calories.
- Check for likely Strava strength duplicates around the recorded start before any new POST; reserve an atomic independent ledger key; submit at most **one** new workout per daily run, with no blind retry after an uncertain outcome.
- Neither the Garmin merge engine nor Python/GitHub Action is modified. This reconciles the shared database later, avoiding coupling to the external GitHub Action completion.
- Automatic writes are **OFF by default**, separately from the prior one-time upload flag. Must set `STRAVA_AUTO_SYNC_ENABLED=true`, `STRAVA_UPLOADS_ENABLED=true`, `STRAVA_AUTO_START_UTC=YYYY-MM-DDTHH:MM:SSZ` (a new activation date, NEVER the date of a historical first test). Avoid past-date backfills.
- Existing `STRAVA_ALLOWED_HEVY_ID` and `STRAVA_FIRST_UPLOAD_UTC` still restrict the *manual* one-workout route only. Auto reconciliation has its own cutoff and keeps its own additional guard.
- For now the scheduler is daily; a newly completed workout may not be posted until the next run. No changes to native Garmin→Strava settings are made by the application.

**User choice:** keep native Garmin→Strava disabled. For cycling, export a real Garmin Connect activity file and import that file into **Strava** manually (not back into Garmin Connect). Do not tell the user that biking is currently auto-synced.

**Rollout gate:** deploy with automatic writes OFF, confirm build and an authorized dry/disabled response, then approve activation explicitly. Never enable the auto flag solely because the first manual upload worked.
