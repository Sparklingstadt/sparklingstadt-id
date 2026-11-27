import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { OIDC_URL_PATHS } from "./lib/id/oidc-urls";

const nextConfig: NextConfig = {
  async redirects() {
    // The root has no page of its own: the account page is the front door.
    return [{ source: "/", destination: "/account", permanent: false }];
  },
  async rewrites() {
    // The OIDC URLs the clients know, served by Better Auth (lib/id/oidc-urls.ts).
    return Object.entries(OIDC_URL_PATHS).map(([source, destination]) => ({ source, destination }));
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // No page is meant to be framed: keeps the sign-in and account pages safe from clickjacking.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // No includeSubDomains: other services may live on sibling hosts of the same domain.
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
    ];
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
