-- Public landing usage stats — anonymous, privacy-safe running totals.
-- Rows are created lazily on first increment (ON CONFLICT upsert). No PII.

-- CreateTable
CREATE TABLE "usage_counters" (
    "key" TEXT NOT NULL,
    "count" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_counters_pkey" PRIMARY KEY ("key")
);
