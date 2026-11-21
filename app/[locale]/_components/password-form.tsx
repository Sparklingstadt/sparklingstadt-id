"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { changePasswordAction } from "../actions";

type Labels = Record<"heading" | "currentPassword" | "newPassword" | "hint" | "submit" | "pending", string>;

/** Passwords are never sent back: the fields are empty after every submit. */
export function PasswordForm({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [state, action, pending] = useActionState(changePasswordAction, undefined);

  return (
    <section className="id-section" aria-labelledby="password-heading">
      <h2 id="password-heading">{labels.heading}</h2>
      <form className="id-form" action={action}>
        <input type="hidden" name="locale" value={locale} />
        <div className="id-field">
          <label htmlFor="current-password">{labels.currentPassword}</label>
          <input id="current-password" name="currentPassword" type="password" autoComplete="current-password"
            required />
        </div>
        <div className="id-field">
          <label htmlFor="new-password">{labels.newPassword}</label>
          <input id="new-password" name="newPassword" type="password" autoComplete="new-password" maxLength={128}
            required aria-describedby="new-password-hint" />
          <small id="new-password-hint">{labels.hint}</small>
        </div>
        {state?.notice ? <p className="id-notice" role="status">{state.notice}</p> : null}
        {state?.error ? <p className="id-alert" role="alert">{state.error}</p> : null}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </button>
      </form>
    </section>
  );
}
