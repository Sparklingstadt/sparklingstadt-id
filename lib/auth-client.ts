import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { twoFactorPagePath } from "@/lib/id/two-factor-redirect";

// A login for a client continues through `next` back to /oauth/authorize (lib/id/oidc-compat.ts), never through the
// oauth-provider plugin's signed oauth_query, so no oauth-provider client plugin is needed.
// When the password was right and 2FA is on, the 2FA page (in the same language, with the same `next` and reauth
// flag) takes over; once a code is accepted it goes on to `next`, which for a client re-enters the authorize checks.
export const authClient = createAuthClient({
  plugins: [
    passkeyClient(),
    twoFactorClient({
      onTwoFactorRedirect: () => {
        window.location.assign(twoFactorPagePath(window.location.pathname, window.location.search));
      },
    }),
  ],
});
