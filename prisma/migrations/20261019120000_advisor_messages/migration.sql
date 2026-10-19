-- The CFO conversation, kept per store.

CREATE TABLE "AdvisorMessage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdvisorMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdvisorMessage_storeId_createdAt_idx" ON "AdvisorMessage"("storeId", "createdAt");

ALTER TABLE "AdvisorMessage" ADD CONSTRAINT "AdvisorMessage_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
