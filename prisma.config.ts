import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

const fallbackUrl = "postgresql://prisma:prisma@localhost:5432/sparklingstadt_id";

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url:
      process.env.DATABASE_URL_UNPOOLED ??
      process.env.DATABASE_URL ??
      fallbackUrl,
  },
});
