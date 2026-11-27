"use client";

import { useActionState, useState } from "react";
import { authClient } from "@/lib/auth-client";

type Labels = Record<
  | "lead" | "backupLead" | "code" | "backupCode" | "submit" | "pending" | "useBackup" | "useTotp" | "expired"
  | "backToLogin" | "wrongCode" | "throttled",
  string
>;

type State = { error?: "wrongCode" | "throttled" | "expired" } | undefined;

const WRONG_CODE = new Set(["INVALID_CODE", "INVALID_BACKUP_CODE"]);

/**
 * The code from the authenticator app, or one backup code. Nothing here trusts the device: every password sign-in
 * asks again. On success it goes to `redirectTo` (for a client, the authorize URL, which then issues the code).
 */
export function TwoFactorForm({ redirectTo, loginHref, labels }: { redirectTo: string; loginHref: string; labels: Labels }) {
  const [backup, setBackup] = useState(false);
  const [state, action, pending] = useActionState(async (_previous: State, formData: FormData): Promise<State> => {
    const code = String(formData.get("code") ?? "").trim();
    const { error } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    if (error) {
      if (error.status === 429) return { error: "throttled" };
      if (error.code && WRONG_CODE.has(error.code)) return { error: "wrongCode" };
      // No pending sign-in (the 10 minutes passed, or the code was asked for too many times): start again.
      return { error: "expired" };
    }
    window.location.assign(redirectTo);
    return undefined;
  }, undefined);

  return (
    <>
      <p className="id-lead">{backup ? labels.backupLead : labels.lead}</p>
      <form className="id-form" action={action} key={backup ? "backup" : "totp"}>
        <div className="id-field">
          <label htmlFor="code">{backup ? labels.backupCode : labels.code}</label>
          {backup ? (
            <input id="code" name="code" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
              maxLength={32} required />
          ) : (
            <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
              pattern="[0-9]{6}" maxLength={6} required />
          )}
        </div>
        {state?.error ? (
          <p className="id-alert" role="alert">
            {labels[state.error]}
            {state.error === "expired" ? <> <a href={loginHref}>{labels.backToLogin}</a></> : null}
          </p>
        ) : null}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </button>
      </form>
      <p className="id-links">
        <button type="button" className="button text" onClick={() => setBackup(!backup)}>
          {backup ? labels.useTotp : labels.useBackup}
        </button>
      </p>
    </>
  );
}
