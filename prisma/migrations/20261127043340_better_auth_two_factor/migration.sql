-- AlterTable
ALTER TABLE "ba_users" ADD COLUMN     "two_factor_enabled" BOOLEAN DEFAULT false;

-- CreateTable
CREATE TABLE "ba_two_factors" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backup_codes" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failed_verification_count" INTEGER DEFAULT 0,
    "locked_until" TIMESTAMP(3),

    CONSTRAINT "ba_two_factors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ba_two_factors_secret_idx" ON "ba_two_factors"("secret");

-- CreateIndex
CREATE INDEX "ba_two_factors_user_id_idx" ON "ba_two_factors"("user_id");

-- AddForeignKey
ALTER TABLE "ba_two_factors" ADD CONSTRAINT "ba_two_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ba_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
