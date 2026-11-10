-- The supplier's payment ledger, and the real per-order cost it implies.
--
-- The ledger bills a day's orders as a range of order numbers, so orders need their
-- number as an integer to be found by range. Existing orders take it from the digits
-- of their name; new ones are written with it at sync.

ALTER TABLE "Order" ADD COLUMN "orderNumber" INTEGER;
ALTER TABLE "Order" ADD COLUMN "supplierCostActual" DOUBLE PRECISION;

UPDATE "Order"
SET "orderNumber" = NULLIF(regexp_replace("name", '\D', '', 'g'), '')::INTEGER
WHERE "name" IS NOT NULL
  -- A name with more digits than an integer holds is not an order number.
  AND length(regexp_replace("name", '\D', '', 'g')) BETWEEN 1 AND 9;

CREATE INDEX "Order_storeId_orderNumber_idx" ON "Order"("storeId", "orderNumber");

CREATE TABLE "SupplierLedgerEntry" (
    "id" TEXT NOT NULL,
    "storeId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "reference" TEXT,
    "firstOrder" INTEGER,
    "lastOrder" INTEGER,
    "amount" DOUBLE PRECISION NOT NULL,
    "matchedOrders" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupplierLedgerEntry_storeId_date_idx" ON "SupplierLedgerEntry"("storeId", "date");
CREATE INDEX "SupplierLedgerEntry_date_idx" ON "SupplierLedgerEntry"("date");

ALTER TABLE "SupplierLedgerEntry" ADD CONSTRAINT "SupplierLedgerEntry_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
