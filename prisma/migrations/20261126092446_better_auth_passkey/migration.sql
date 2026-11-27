-- CreateTable
CREATE TABLE "ba_passkeys" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "public_key" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "device_type" TEXT NOT NULL,
    "backed_up" BOOLEAN NOT NULL,
    "transports" TEXT,
    "created_at" TIMESTAMP(3),
    "aaguid" TEXT,

    CONSTRAINT "ba_passkeys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ba_passkeys_credential_id_key" ON "ba_passkeys"("credential_id");

-- CreateIndex
CREATE INDEX "ba_passkeys_user_id_idx" ON "ba_passkeys"("user_id");

-- AddForeignKey
ALTER TABLE "ba_passkeys" ADD CONSTRAINT "ba_passkeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ba_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
