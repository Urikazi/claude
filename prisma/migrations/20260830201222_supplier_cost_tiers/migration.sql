-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingCountry" TEXT;

-- AlterTable
ALTER TABLE "OrderLineItem" ADD COLUMN     "lineCost" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SupplierCostTier" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCostTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCostTier_storeId_sku_idx" ON "SupplierCostTier"("storeId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierCostTier_storeId_sku_country_quantity_key" ON "SupplierCostTier"("storeId", "sku", "country", "quantity");

-- AddForeignKey
ALTER TABLE "SupplierCostTier" ADD CONSTRAINT "SupplierCostTier_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
