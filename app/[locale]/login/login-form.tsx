"use client";

import { useActionState } from "react";
import { authClient } from "@/lib/auth-client";
import type { FormState } from "../actions";

type Labels = Record<"email" | "password" | "submit" | "pending" | "invalidCredentials" | "throttled", string>;

export function LogInForm({ redirectTo, labels }: { redirectTo: string; labels: Labels }) {
  // A form action (not an onSubmit handler) so that a submit before hydration is replayed, never sent as a plain GET.
  const [state, action, pending] = useActionState(async (_previous: FormState, formData: FormData): Promise<FormState> => {
    const email = String(formData.get("email") ?? "").trim();
    const { data, error } = await authClient.signIn.email({ email, password: String(formData.get("password") ?? "") });
    if (error) {
      // One message for an unknown address, a wrong password and a malformed address.
      return { error: error.status === 429 ? labels.throttled : labels.invalidCredentials, fields: { email } };
    }
    // 2FA is on: no session yet. The auth client's onTwoFactorRedirect has gone on to the code page (lib/auth-client.ts).
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) return { fields: { email } };
    // For a client, `next` is the authorize URL itself, which then issues the code.
    window.location.assign(redirectTo);
    return { fields: { email } };
  }, undefined);

  return (
    <form className="id-form" action={action}>
      <div className="id-field">
        <label htmlFor="email">{labels.email}</label>
        <input id="email" name="email" type="email" autoComplete="username webauthn" required
          defaultValue={state?.fields?.email} />
      </div>
      <div className="id-field">
        <label htmlFor="password">{labels.password}</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {state?.error ? <p className="id-alert" role="alert">{state.error}</p> : null}
      <button type="submit" className="button primary" disabled={pending}>
        {pending ? labels.pending : labels.submit}
      </button>
    </form>
  );
}
