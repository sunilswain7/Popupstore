-- AlterTable: increase decimal precision for micro-prices (e.g. $0.001)
ALTER TABLE "items" ALTER COLUMN "price_usdc" SET DATA TYPE DECIMAL(10, 6);
ALTER TABLE "transactions" ALTER COLUMN "amount_usdc" SET DATA TYPE DECIMAL(10, 6);
