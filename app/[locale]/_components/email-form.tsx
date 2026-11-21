"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { requestEmailChangeAction } from "../actions";

type Labels = Record<"heading" | "lead" | "email" | "currentPassword" | "submit" | "pending", string>;

/** The current password is never sent back to the form. */
export function EmailForm({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [state, action, pending] = useActionState(requestEmailChangeAction, undefined);

  return (
    <section className="id-section" aria-labelledby="email-heading">
      <h2 id="email-heading">{labels.heading}</h2>
      <p className="id-lead">{labels.lead}</p>
      <form className="id-form" action={action}>
        <input type="hidden" name="locale" value={locale} />
        <div className="id-field">
          <label htmlFor="new-email">{labels.email}</label>
          <input id="new-email" name="email" type="email" autoComplete="email" maxLength={254} required
            defaultValue={state?.fields?.email} />
        </div>
        <div className="id-field">
          <label htmlFor="email-current-password">{labels.currentPassword}</label>
          <input id="email-current-password" name="currentPassword" type="password"
            autoComplete="current-password" required />
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
