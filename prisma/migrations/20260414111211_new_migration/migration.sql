-- AlterTable
ALTER TABLE "DiscountRule" ADD COLUMN     "conditionsUniversal" JSONB,
ADD COLUMN     "engineVersion" TEXT NOT NULL DEFAULT 'legacy',
ALTER COLUMN "type" DROP NOT NULL,
ALTER COLUMN "percentage" SET DEFAULT 0,
ALTER COLUMN "conditions" DROP NOT NULL,
ALTER COLUMN "layer" DROP NOT NULL;
