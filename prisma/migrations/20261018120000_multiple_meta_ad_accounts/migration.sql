-- Meta ad accounts move off Store onto their own table, so a store can draw spend
-- from several. The single pair of columns is carried over as the first account
-- before being dropped, so a store that is already connected stays connected.

CREATE TABLE "MetaAdAccount" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MetaAdAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaAdAccount_storeId_accountId_key" ON "MetaAdAccount"("storeId", "accountId");
CREATE INDEX "MetaAdAccount_storeId_idx" ON "MetaAdAccount"("storeId");

ALTER TABLE "MetaAdAccount" ADD CONSTRAINT "MetaAdAccount_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over every store that already has both halves of a Meta connection. A row
-- with only one of the two was never usable, so it is left behind rather than
-- migrated into an account that cannot authenticate.
INSERT INTO "MetaAdAccount" ("id", "storeId", "accountId", "accessToken", "label", "active", "position", "createdAt", "updatedAt")
SELECT
    md5(random()::text || clock_timestamp()::text)::uuid::text,
    "id",
    "metaAdAccountId",
    "metaAccessToken",
    NULL,
    true,
    0,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Store"
WHERE "metaAdAccountId" IS NOT NULL
  AND "metaAdAccountId" <> ''
  AND "metaAccessToken" IS NOT NULL
  AND "metaAccessToken" <> '';

ALTER TABLE "Store" DROP COLUMN "metaAdAccountId";
ALTER TABLE "Store" DROP COLUMN "metaAccessToken";

-- Existing spend rows predate per-account attribution; they are left blank and fill
-- in on the next sync rather than being guessed at.
ALTER TABLE "AdSpendEntry" ADD COLUMN "adAccountId" TEXT NOT NULL DEFAULT '';
