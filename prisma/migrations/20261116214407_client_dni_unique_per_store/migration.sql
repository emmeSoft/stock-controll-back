-- Add per-store unique constraint on client.dni.
-- Verified against real data: 0 duplicate (storeId, dni) pairs among 17 rows
-- as of 2026-11-16, so this is safe with no data cleanup.
CREATE UNIQUE INDEX "client_storeId_dni_key" ON "client"("storeId", "dni");
