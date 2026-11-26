import type { Page } from "@playwright/test";

/**
 * A virtual authenticator that behaves like Touch ID or Windows Hello: it holds discoverable credentials and
 * verifies the user without asking. Chromium only (CDP).
 */
export async function addVirtualAuthenticator(page: Page): Promise<{ authenticatorId: string; remove(): Promise<void> }> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });
  return {
    authenticatorId,
    async remove() {
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      await cdp.send("WebAuthn.disable");
    },
  };
}
