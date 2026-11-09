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
