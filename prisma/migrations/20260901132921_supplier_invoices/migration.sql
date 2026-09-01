-- CreateTable
CREATE TABLE "SupplierInvoice" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "invoiceDate" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lineCount" INTEGER NOT NULL,
    "billedLines" INTEGER NOT NULL,
    "totalCharged" DOUBLE PRECISION NOT NULL,
    "totalExpected" DOUBLE PRECISION NOT NULL,
    "variance" DOUBLE PRECISION NOT NULL,
    "overchargedCount" INTEGER NOT NULL DEFAULT 0,
    "underchargedCount" INTEGER NOT NULL DEFAULT 0,
    "unquotedCount" INTEGER NOT NULL DEFAULT 0,
    "statedTotal" DOUBLE PRECISION,
    "lineSum" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "SupplierInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierInvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "orderRef" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "charged" DOUBLE PRECISION NOT NULL,
    "expected" DOUBLE PRECISION,
    "variance" DOUBLE PRECISION NOT NULL,
    "verdict" TEXT NOT NULL,

    CONSTRAINT "SupplierInvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierInvoice_storeId_uploadedAt_idx" ON "SupplierInvoice"("storeId", "uploadedAt");

-- CreateIndex
CREATE INDEX "SupplierInvoiceLine_invoiceId_verdict_idx" ON "SupplierInvoiceLine"("invoiceId", "verdict");

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceLine" ADD CONSTRAINT "SupplierInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "SupplierInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
