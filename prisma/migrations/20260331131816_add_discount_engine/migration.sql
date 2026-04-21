-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('QUANTITY', 'CASH_PAYMENT', 'CLIENT', 'SPECIAL_DATE', 'PRODUCT', 'CATEGORY', 'MIN_AMOUNT', 'LIMITED_STOCK');

-- CreateEnum
CREATE TYPE "DiscountLayer" AS ENUM ('ITEM', 'ORDER');

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "discountTotal" DOUBLE PRECISION DEFAULT 0;

-- AlterTable
ALTER TABLE "store" ADD COLUMN     "maxDiscountPct" DOUBLE PRECISION NOT NULL DEFAULT 50;

-- CreateTable
CREATE TABLE "DiscountRule" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "DiscountType" NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "conditions" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "layer" "DiscountLayer" NOT NULL,
    "isCombinable" BOOLEAN NOT NULL DEFAULT true,
    "combinesWith" "DiscountType"[],
    "maxPercentage" DOUBLE PRECISION,
    "usedUnits" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscountRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppliedDiscount" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "discountRuleId" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "layer" "DiscountLayer" NOT NULL,
    "percentage" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "productId" TEXT,
    "discountedQuantity" INTEGER,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppliedDiscount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscountRule_storeId_isActive_idx" ON "DiscountRule"("storeId", "isActive");

-- CreateIndex
CREATE INDEX "DiscountRule_type_idx" ON "DiscountRule"("type");

-- CreateIndex
CREATE INDEX "AppliedDiscount_orderId_idx" ON "AppliedDiscount"("orderId");

-- CreateIndex
CREATE INDEX "AppliedDiscount_discountRuleId_idx" ON "AppliedDiscount"("discountRuleId");

-- AddForeignKey
ALTER TABLE "DiscountRule" ADD CONSTRAINT "DiscountRule_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscountRule" ADD CONSTRAINT "DiscountRule_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedDiscount" ADD CONSTRAINT "AppliedDiscount_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppliedDiscount" ADD CONSTRAINT "AppliedDiscount_discountRuleId_fkey" FOREIGN KEY ("discountRuleId") REFERENCES "DiscountRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
