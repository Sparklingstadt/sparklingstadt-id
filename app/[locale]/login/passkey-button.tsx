"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Labels = Record<"label" | "pending" | "failed", string>;

/**
 * Sign-in with a passkey. The same ceremony also runs as conditional UI: the browser offers the passkey in the
 * email field's autofill list (autocomplete="username webauthn"), and picking it signs in. Like the password form,
 * it ends by going to `redirectTo` (for a client, the authorize URL, which then issues the code). A passkey sign-in
 * never asks for the 2FA code: the device already verified the user, and the twoFactor plugin holds back only the
 * password sign-in (lib/auth.ts), so /passkey/verify-authentication makes the session at once.
 */
export function PasskeyButton({ redirectTo, labels }: { redirectTo: string; labels: Labels }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  // The conditional request and the button can both end in a sign-in; the page is left once.
  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    window.location.assign(redirectTo);
  }, [redirectTo]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!(await window.PublicKeyCredential?.isConditionalMediationAvailable?.())) return;
        const { error } = await authClient.signIn.passkey({ autoFill: true });
        if (!cancelled && !error) leave();
      } catch {
        // Conditional UI is an extra: a browser without it just shows the button.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [leave]);

  async function signIn() {
    setPending(true);
    setFailed(false);
    const { error } = await authClient.signIn.passkey();
    if (error) {
      setFailed(true);
      setPending(false);
      return;
    }
    leave();
  }

  return (
    <div className="id-section">
      <button type="button" className="button" disabled={pending} onClick={signIn}>
        {pending ? labels.pending : labels.label}
      </button>
      {failed ? <p className="id-alert" role="alert">{labels.failed}</p> : null}
    </div>
  );
}
