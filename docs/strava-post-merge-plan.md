# Strava post-merge synchronization — implementation plan

## Objective
Preserve the original Garmin heart-rate recording in Strava, while updating **the same existing Strava activity** with the Hevy2Garmin consolidated workout name and description, after Garmin's merge succeeds. This is distinct from uploading a new FIT; the Strava API does not offer replacement of an existing activity's FIT streams or strength sets.

## Explicit prerequisites
1. Disable direct Hevy → Strava publishing to avoid duplicates; retain Garmin → Strava publishing.
2. Add an explicit Strava OAuth connection with `activity:read_all,activity:write` scopes (respect account privacy and get minimum required permissions).
3. Store rotating Strava refresh tokens encrypted server-side using the application's existing credentials approach. Never expose secrets to browser code.
4. Create a durable, unique association of `Hevy workout ID + Garmin activity ID + Strava activity ID` in Postgres, with an idempotency key and last successful content hash.

## Safe flow
1. On *successful* Garmin merge, enqueue a post-merge Strava metadata job; do not block the Garmin sync.
2. Allow Strava to receive the original Garmin activity first. Use limited retries/backoff to look it up.
3. Find candidates in a narrow time window using start time and duration. **Never automatically update on an ambiguous match.** Strava may have multiple overlapping Hevy and Garmin activities.
4. Fetch the candidate's full Strava activity details and verify Garmin source/device when exposed; if unverifiable, require explicit one-time user selection and persist the link. Start with historical test IDs: Garmin original Strava activity `20785963871`; Hevy duplicate `20785981962`. Do NOT automatically delete either.
5. Update ONLY the matched Garmin Strava activity using `PUT /api/v3/activities/{id}` with name and description. Preserve existing description if it has user edits, or require consent to replace it.
6. Mark job complete only after confirming Strava accepted the update; handle 429, token expiry, transient errors, and rate limits; do not trigger upload/delete.
7. Expose an opt-in, dry-run preview and manual retry. Never modify historical activities in bulk by default.

## Limitations
- Strava's metadata API does not rewrite FIT exercise records or replace native heart-rate streams. Garmin's original HR stream remains the source.
- A Garmin Connect resync does **not** automatically update Strava.
- This branch currently includes **only API primitives**, not OAuth UI, database migration, queue/trigger, or deployment wiring. No behavior changes in production.

## Acceptance tests
- One activity in Strava, sourced from the watch, with its original HR graph plus the Hevy name and detailed sets in the description.
- Re-run does not create a duplicate or overwrite manually edited descriptions.
- Missing/ambiguous matching results in no modification and a visible warning.
- Strava unavailable or tokens invalid must not interrupt the Garmin merge.
