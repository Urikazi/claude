-- A spend row is identified by the account as well as the campaign.
--
-- The old key assumed Meta campaign ids never repeat across ad accounts. Even where
-- that holds it is someone else's invariant, and being wrong about it loses a day of
-- one account's spend silently — the upsert simply overwrites. Existing rows are
-- unaffected: they keep whatever adAccountId they were written with, blank included.

DROP INDEX "AdSpendEntry_storeId_date_platform_campaignId_key";

CREATE UNIQUE INDEX "AdSpendEntry_storeId_date_platform_adAccountId_campaignId_key"
    ON "AdSpendEntry"("storeId", "date", "platform", "adAccountId", "campaignId");

CREATE INDEX "AdSpendEntry_storeId_adAccountId_idx" ON "AdSpendEntry"("storeId", "adAccountId");
