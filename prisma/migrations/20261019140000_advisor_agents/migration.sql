-- A second advisor joins the CFO, so each turn records which one it belongs to.
-- Existing turns are the CFO's, which the default already says.

ALTER TABLE "AdvisorMessage" ADD COLUMN "agent" TEXT NOT NULL DEFAULT 'cfo';

DROP INDEX "AdvisorMessage_storeId_createdAt_idx";
CREATE INDEX "AdvisorMessage_storeId_agent_createdAt_idx" ON "AdvisorMessage"("storeId", "agent", "createdAt");
