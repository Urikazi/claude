-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "DailyTraffic" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyTraffic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreChange" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyTraffic_storeId_date_idx" ON "DailyTraffic"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyTraffic_storeId_date_key" ON "DailyTraffic"("storeId", "date");

-- CreateIndex
CREATE INDEX "StoreChange_storeId_date_idx" ON "StoreChange"("storeId", "date");

-- CreateIndex
CREATE INDEX "Order_storeId_customerId_idx" ON "Order"("storeId", "customerId");

-- AddForeignKey
ALTER TABLE "DailyTraffic" ADD CONSTRAINT "DailyTraffic_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreChange" ADD CONSTRAINT "StoreChange_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
