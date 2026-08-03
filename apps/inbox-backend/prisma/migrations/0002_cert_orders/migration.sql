-- F9.2 — compra/emisión de certificados (ArgosData/Signare).
-- Aditivo: NO altera tablas existentes (pending_pdfs, audit_logs).

-- CreateEnum
CREATE TYPE "CertOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'PAYMENT_FAILED', 'SUBMIT_FAILED');

-- CreateTable
CREATE TABLE "cert_orders" (
    "id" TEXT NOT NULL,
    "status" "CertOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "pvp" DECIMAL(10,2) NOT NULL,
    "email" TEXT NOT NULL,
    "pricingPlanId" INTEGER NOT NULL,
    "certInput" JSONB NOT NULL,
    "filesRef" TEXT,
    "paymentId" TEXT,
    "paymentUrl" TEXT,
    "certCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cert_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cert_order_events" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cert_order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cert_orders_certCode_key" ON "cert_orders"("certCode");

-- CreateIndex
CREATE INDEX "cert_orders_status_idx" ON "cert_orders"("status");

-- CreateIndex
CREATE INDEX "cert_order_events_orderId_idx" ON "cert_order_events"("orderId");

-- AddForeignKey
ALTER TABLE "cert_order_events" ADD CONSTRAINT "cert_order_events_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "cert_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
