-- F3.5 inbox-backend initial schema.
-- Run AFTER `firmar_ec_inbox` database exists in Patroni (see scripts/provision-db.sh).

-- CreateEnum
CREATE TYPE "PdfStatus" AS ENUM ('PENDING', 'SIGNED', 'DELIVERED', 'EXPIRED');

-- CreateTable
CREATE TABLE "pending_pdfs" (
    "id" TEXT NOT NULL,
    "otpHash" TEXT NOT NULL,
    "senderPhoneHash" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "r2Key" TEXT NOT NULL,
    "encryptedKeyHint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ttlAt" TIMESTAMP(3) NOT NULL,
    "status" "PdfStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "pending_pdfs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_pdfs_otpHash_key" ON "pending_pdfs"("otpHash");

-- CreateIndex
CREATE INDEX "pending_pdfs_senderPhoneHash_idx" ON "pending_pdfs"("senderPhoneHash");

-- CreateIndex
CREATE INDEX "pending_pdfs_ttlAt_idx" ON "pending_pdfs"("ttlAt");
