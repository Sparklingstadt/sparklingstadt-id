"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { requestPasswordResetAction } from "../actions";

type Labels = Record<"heading" | "lead" | "email" | "submit" | "pending" | "sentHeading", string>;

/** Shows the same "sent" screen whether or not the address has an account. */
export function ForgotForm({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);

  if (state?.notice) {
    return (
      <div role="status">
        <h1>{labels.sentHeading}</h1>
        <p className="id-lead">{state.notice}</p>
      </div>
    );
  }

  return (
    <>
      <h1>{labels.heading}</h1>
      <p className="id-lead">{labels.lead}</p>
      <form className="id-form" action={action}>
        <input type="hidden" name="locale" value={locale} />
        <div className="id-field">
          <label htmlFor="email">{labels.email}</label>
          <input id="email" name="email" type="email" autoComplete="email" maxLength={254} required
            defaultValue={state?.fields?.email} />
        </div>
        {state?.error ? <p className="id-alert" role="alert">{state.error}</p> : null}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </button>
      </form>
    </>
  );
}
