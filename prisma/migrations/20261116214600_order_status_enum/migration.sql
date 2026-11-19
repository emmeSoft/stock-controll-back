-- Convert order.status from a free-form String to the OrderStatus enum.
--
-- Real data checked 2026-11-16: 8 rows total, 6 with status = 'completed'
-- (lowercase) and 2 already at status = 'CANCELLED' (uppercase). This
-- migration maps the lowercase legacy values to the new uppercase enum
-- labels BEFORE changing the column type, because Postgres refuses an
-- enum type change if any existing row value isn't a valid label at the
-- moment of the ALTER.

-- 1. Create the enum type.
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- 2. Data fix: uppercase the legacy lowercase 'completed' values.
--    ('CANCELLED' rows are already correct and need no change.)
UPDATE "order" SET status = 'COMPLETED' WHERE status = 'completed';

-- 3. Drop the old String default ('pending') so the column can be
--    retyped; a text default is not valid for the new enum type.
ALTER TABLE "order" ALTER COLUMN "status" DROP DEFAULT;

-- 4. Change the column type, casting existing (now all-uppercase,
--    enum-valid) text values into OrderStatus.
ALTER TABLE "order"
  ALTER COLUMN "status" TYPE "OrderStatus" USING ("status"::"OrderStatus");

-- 5. Restore the default, now typed as the enum.
ALTER TABLE "order" ALTER COLUMN "status" SET DEFAULT 'PENDING';
