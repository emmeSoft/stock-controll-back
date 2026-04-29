-- CreateEnum
CREATE TYPE "CurrentAccountStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CurrentAccountMovementType" AS ENUM ('SALE', 'PAYMENT', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "CurrentAccount" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "CurrentAccountStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurrentAccountMovement" (
    "id" TEXT NOT NULL,
    "currentAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "CurrentAccountMovementType" NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "paidAmount" DOUBLE PRECISION NOT NULL,
    "debtAmount" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "orderId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrentAccountMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccount_clientId_key" ON "CurrentAccount"("clientId");

-- CreateIndex
CREATE INDEX "CurrentAccount_storeId_status_idx" ON "CurrentAccount"("storeId", "status");

-- CreateIndex
CREATE INDEX "CurrentAccount_clientId_idx" ON "CurrentAccount"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CurrentAccountMovement_orderId_key" ON "CurrentAccountMovement"("orderId");

-- CreateIndex
CREATE INDEX "CurrentAccountMovement_currentAccountId_idx" ON "CurrentAccountMovement"("currentAccountId");

-- CreateIndex
CREATE INDEX "CurrentAccountMovement_userId_idx" ON "CurrentAccountMovement"("userId");

-- AddForeignKey
ALTER TABLE "CurrentAccount" ADD CONSTRAINT "CurrentAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccount" ADD CONSTRAINT "CurrentAccount_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountMovement" ADD CONSTRAINT "CurrentAccountMovement_currentAccountId_fkey" FOREIGN KEY ("currentAccountId") REFERENCES "CurrentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountMovement" ADD CONSTRAINT "CurrentAccountMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurrentAccountMovement" ADD CONSTRAINT "CurrentAccountMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
