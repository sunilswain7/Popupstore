-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "drop_name" TEXT NOT NULL,
    "end_date" TIMESTAMPTZ NOT NULL,
    "post_drop_action" TEXT NOT NULL,
    "locus_project_id" TEXT,
    "locus_service_id" TEXT,
    "locus_service_url" TEXT,
    "locus_deployment_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activated_at" TIMESTAMPTZ,
    "sold_out_at" TIMESTAMPTZ,
    "archived_at" TIMESTAMPTZ,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "price_usdc" DECIMAL(10,2) NOT NULL,
    "inventory_total" INTEGER NOT NULL,
    "inventory_remaining" INTEGER NOT NULL,
    "image_url" TEXT,
    "checkout_session_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "item_id" TEXT,
    "amount_usdc" DECIMAL(10,2) NOT NULL,
    "buyer_address" TEXT,
    "tx_hash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "webhook_event_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "transactions_webhook_event_id_key" ON "transactions"("webhook_event_id");

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
