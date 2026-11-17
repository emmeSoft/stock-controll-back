-- Adds the SISTEMA-only subscription-tier signal to `store`.
-- Additive, idempotent, non-destructive: Postgres backfills every existing
-- row to `true` as part of the `ADD COLUMN ... NOT NULL DEFAULT true`
-- statement, so no separate UPDATE is required.
--
-- House convention: hand-written, NOT executed against the deployed
-- Supabase database without explicit human go-ahead. Safe to run against a
-- local/dev database for integrity-test purposes.
ALTER TABLE "store" ADD COLUMN IF NOT EXISTS "isFreeTier" BOOLEAN NOT NULL DEFAULT true;
