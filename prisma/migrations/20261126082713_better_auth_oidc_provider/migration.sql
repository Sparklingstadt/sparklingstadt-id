-- CreateTable
CREATE TABLE "ba_jwks" (
    "id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "private_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3),
    "alg" TEXT,
    "crv" TEXT,

    CONSTRAINT "ba_jwks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_oauth_clients" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_secret" TEXT,
    "client_discovery_id" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skip_consent" BOOLEAN,
    "enable_end_session" BOOLEAN,
    "subject_type" TEXT,
    "scopes" TEXT[],
    "client_credentials_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "user_id" TEXT,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "software_id" TEXT,
    "software_version" TEXT,
    "software_statement" TEXT,
    "redirect_uris" TEXT[],
    "post_logout_redirect_uris" TEXT[],
    "backchannel_logout_uri" TEXT,
    "backchannel_logout_session_required" BOOLEAN,
    "token_endpoint_auth_method" TEXT,
    "application_type" TEXT,
    "jwks" TEXT,
    "jwks_uri" TEXT,
    "grant_types" TEXT[],
    "response_types" TEXT[],
    "require_pkce" BOOLEAN,
    "dpop_bound_access_tokens" BOOLEAN DEFAULT false,
    "reference_id" TEXT,
    "metadata" TEXT,

    CONSTRAINT "ba_oauth_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_oauth_resources" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "access_token_ttl" INTEGER,
    "refresh_token_ttl" INTEGER,
    "signing_algorithm" TEXT,
    "signing_key_id" TEXT,
    "allowed_scopes" TEXT[],
    "custom_claims" TEXT,
    "dpop_bound_access_tokens_required" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),
    "policy_version" INTEGER DEFAULT 1,
    "metadata" TEXT,

    CONSTRAINT "ba_oauth_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_oauth_client_resources" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "metadata" TEXT,
    "created_at" TIMESTAMP(3),

    CONSTRAINT "ba_oauth_client_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT NOT NULL,
    "reference_id" TEXT,
    "authorization_code_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "revoked" TIMESTAMP(3),
    "rotated_at" TIMESTAMP(3),
    "rotation_replay_response" TEXT,
    "rotation_replay_expires_at" TIMESTAMP(3),
    "auth_time" TIMESTAMP(3),
    "confirmation" TEXT,
    "scopes" TEXT[],

    CONSTRAINT "ba_oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_oauth_access_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT,
    "client_id" TEXT NOT NULL,
    "session_id" TEXT,
    "user_id" TEXT,
    "reference_id" TEXT,
    "authorization_code_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "refresh_id" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3),
    "revoked" TIMESTAMP(3),
    "confirmation" TEXT,
    "scopes" TEXT[],

    CONSTRAINT "ba_oauth_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_oauth_consents" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "user_id" TEXT,
    "reference_id" TEXT,
    "resources" TEXT[],
    "requested_user_info_claims" TEXT[],
    "scopes" TEXT[],
    "created_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "ba_oauth_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ba_oauth_client_assertions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ba_oauth_client_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ba_oauth_clients_client_id_key" ON "ba_oauth_clients"("client_id");

-- CreateIndex
CREATE INDEX "ba_oauth_clients_user_id_idx" ON "ba_oauth_clients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_oauth_resources_identifier_key" ON "ba_oauth_resources"("identifier");

-- CreateIndex
CREATE INDEX "ba_oauth_client_resources_client_id_idx" ON "ba_oauth_client_resources"("client_id");

-- CreateIndex
CREATE INDEX "ba_oauth_client_resources_resource_id_idx" ON "ba_oauth_client_resources"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_oauth_client_resources_client_id_resource_id_key" ON "ba_oauth_client_resources"("client_id", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_oauth_refresh_tokens_token_key" ON "ba_oauth_refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "ba_oauth_refresh_tokens_client_id_idx" ON "ba_oauth_refresh_tokens"("client_id");

-- CreateIndex
CREATE INDEX "ba_oauth_refresh_tokens_session_id_idx" ON "ba_oauth_refresh_tokens"("session_id");

-- CreateIndex
CREATE INDEX "ba_oauth_refresh_tokens_user_id_idx" ON "ba_oauth_refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "ba_oauth_refresh_tokens_authorization_code_id_idx" ON "ba_oauth_refresh_tokens"("authorization_code_id");

-- CreateIndex
CREATE UNIQUE INDEX "ba_oauth_access_tokens_token_key" ON "ba_oauth_access_tokens"("token");

-- CreateIndex
CREATE INDEX "ba_oauth_access_tokens_client_id_idx" ON "ba_oauth_access_tokens"("client_id");

-- CreateIndex
CREATE INDEX "ba_oauth_access_tokens_session_id_idx" ON "ba_oauth_access_tokens"("session_id");

-- CreateIndex
CREATE INDEX "ba_oauth_access_tokens_user_id_idx" ON "ba_oauth_access_tokens"("user_id");

-- CreateIndex
CREATE INDEX "ba_oauth_access_tokens_authorization_code_id_idx" ON "ba_oauth_access_tokens"("authorization_code_id");

-- CreateIndex
CREATE INDEX "ba_oauth_access_tokens_refresh_id_idx" ON "ba_oauth_access_tokens"("refresh_id");

-- CreateIndex
CREATE INDEX "ba_oauth_consents_client_id_idx" ON "ba_oauth_consents"("client_id");

-- CreateIndex
CREATE INDEX "ba_oauth_consents_user_id_idx" ON "ba_oauth_consents"("user_id");

-- AddForeignKey
ALTER TABLE "ba_oauth_clients" ADD CONSTRAINT "ba_oauth_clients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ba_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_client_resources" ADD CONSTRAINT "ba_oauth_client_resources_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "ba_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_client_resources" ADD CONSTRAINT "ba_oauth_client_resources_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "ba_oauth_resources"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_refresh_tokens" ADD CONSTRAINT "ba_oauth_refresh_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "ba_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_refresh_tokens" ADD CONSTRAINT "ba_oauth_refresh_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ba_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_refresh_tokens" ADD CONSTRAINT "ba_oauth_refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ba_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_access_tokens" ADD CONSTRAINT "ba_oauth_access_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "ba_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_access_tokens" ADD CONSTRAINT "ba_oauth_access_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ba_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_access_tokens" ADD CONSTRAINT "ba_oauth_access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ba_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_access_tokens" ADD CONSTRAINT "ba_oauth_access_tokens_refresh_id_fkey" FOREIGN KEY ("refresh_id") REFERENCES "ba_oauth_refresh_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_consents" ADD CONSTRAINT "ba_oauth_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "ba_oauth_clients"("client_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ba_oauth_consents" ADD CONSTRAINT "ba_oauth_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "ba_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
