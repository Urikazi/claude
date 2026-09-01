-- The new customer figures a store steers by are the ones its ad account reports.
-- Default the preference on, and adopt it for stores created before it existed, whose
-- false was a default rather than a decision.
ALTER TABLE "Store" ALTER COLUMN "metaReportsNewCustomersOnly" SET DEFAULT true;
UPDATE "Store" SET "metaReportsNewCustomersOnly" = true;
