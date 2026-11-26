import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/react";

// A login for a client continues through `next` back to /oauth/authorize (lib/id/oidc-compat.ts), never through the
// oauth-provider plugin's signed oauth_query, so no oauth-provider client plugin is needed.
export const authClient = createAuthClient({ plugins: [passkeyClient()] });
