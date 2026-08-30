-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "shopifyDomain" TEXT,
    "shopifyAccessToken" TEXT,
    "metaAdAccountId" TEXT,
    "metaAccessToken" TEXT,
    "stripeSecretKey" TEXT,
    "paypalClientId" TEXT,
    "paypalClientSecret" TEXT,
    "paypalLiveMode" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "FeeConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "shopifyTransactionRate" REAL NOT NULL DEFAULT 0.006,
    "stripePercent" REAL NOT NULL DEFAULT 0.029,
    "stripeFixed" REAL NOT NULL DEFAULT 0.30,
    "paypalPercent" REAL NOT NULL DEFAULT 0.0349,
    "paypalFixed" REAL NOT NULL DEFAULT 0.49,
    "defaultPercent" REAL NOT NULL DEFAULT 0,
    "defaultFixed" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeeConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "shopifyId" TEXT,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "imageUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "shopifyId" TEXT,
    "sku" TEXT,
    "title" TEXT NOT NULL DEFAULT 'Default',
    "price" REAL NOT NULL DEFAULT 0,
    "cogs" REAL NOT NULL DEFAULT 0,
    "shippingCost" REAL NOT NULL DEFAULT 0,
    "handlingCost" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "shopifyId" TEXT,
    "name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "processedAt" DATETIME NOT NULL,
    "financialStatus" TEXT,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "discountTotal" REAL NOT NULL DEFAULT 0,
    "shippingTotal" REAL NOT NULL DEFAULT 0,
    "taxTotal" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL DEFAULT 0,
    "refundedTotal" REAL NOT NULL DEFAULT 0,
    "gateway" TEXT NOT NULL DEFAULT 'OTHER',
    "gatewayName" TEXT,
    "processorFeeActual" REAL,
    "processorFeeEstimate" REAL NOT NULL DEFAULT 0,
    "shopifyFee" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT,
    "shopifyId" TEXT,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" REAL NOT NULL DEFAULT 0,
    "discountAllocated" REAL NOT NULL DEFAULT 0,
    "unitCogs" REAL NOT NULL DEFAULT 0,
    "unitShipping" REAL NOT NULL DEFAULT 0,
    "unitHandling" REAL NOT NULL DEFAULT 0,
    CONSTRAINT "OrderLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLineItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AdSpendEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'meta',
    "campaignId" TEXT NOT NULL DEFAULT '',
    "campaignName" TEXT,
    "spend" REAL NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AdSpendEntry_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "records" INTEGER NOT NULL DEFAULT 0,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    CONSTRAINT "SyncLog_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FeeConfig_storeId_key" ON "FeeConfig"("storeId");

-- CreateIndex
CREATE INDEX "Product_storeId_idx" ON "Product"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_storeId_shopifyId_key" ON "Product"("storeId", "shopifyId");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductVariant_productId_shopifyId_key" ON "ProductVariant"("productId", "shopifyId");

-- CreateIndex
CREATE INDEX "Order_storeId_processedAt_idx" ON "Order"("storeId", "processedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_storeId_shopifyId_key" ON "Order"("storeId", "shopifyId");

-- CreateIndex
CREATE INDEX "OrderLineItem_orderId_idx" ON "OrderLineItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderLineItem_variantId_idx" ON "OrderLineItem"("variantId");

-- CreateIndex
CREATE INDEX "AdSpendEntry_storeId_date_idx" ON "AdSpendEntry"("storeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdSpendEntry_storeId_date_platform_campaignId_key" ON "AdSpendEntry"("storeId", "date", "platform", "campaignId");

-- CreateIndex
CREATE INDEX "SyncLog_storeId_source_startedAt_idx" ON "SyncLog"("storeId", "source", "startedAt");
