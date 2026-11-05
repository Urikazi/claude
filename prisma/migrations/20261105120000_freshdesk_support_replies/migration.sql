-- Freshdesk: per-store credentials and the log of messages Claude has answered.

ALTER TABLE "Store" ADD COLUMN "freshdeskDomain" TEXT;
ALTER TABLE "Store" ADD COLUMN "freshdeskApiKey" TEXT;
ALTER TABLE "Store" ADD COLUMN "freshdeskMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Store" ADD COLUMN "freshdeskWebhookSecret" TEXT;
ALTER TABLE "Store" ADD COLUMN "supportPolicies" TEXT;

CREATE TABLE "SupportReply" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "messageKey" TEXT NOT NULL,
    "subject" TEXT,
    "requesterEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "category" TEXT,
    "confidence" TEXT,
    "reason" TEXT,
    "body" TEXT,
    "error" TEXT,
    "trigger" TEXT NOT NULL DEFAULT 'webhook',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportReply_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportReply_storeId_ticketId_messageKey_key" ON "SupportReply"("storeId", "ticketId", "messageKey");
CREATE INDEX "SupportReply_storeId_createdAt_idx" ON "SupportReply"("storeId", "createdAt");

ALTER TABLE "SupportReply" ADD CONSTRAINT "SupportReply_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
