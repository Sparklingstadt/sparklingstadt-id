"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { signUpAction } from "../actions";

type Labels = Record<
  | "heading" | "lead" | "email" | "displayName" | "displayNameHint" | "password" | "passwordHint"
  | "submit" | "pending" | "sentHeading",
  string
>;

export function SignUpForm({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [state, action, pending] = useActionState(signUpAction, undefined);

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
        <div className="id-field">
          <label htmlFor="displayName">{labels.displayName}</label>
          <input id="displayName" name="displayName" autoComplete="nickname" maxLength={50} required
            defaultValue={state?.fields?.displayName} aria-describedby="displayName-hint" />
          <small id="displayName-hint">{labels.displayNameHint}</small>
        </div>
        <div className="id-field">
          <label htmlFor="password">{labels.password}</label>
          <input id="password" name="password" type="password" autoComplete="new-password" maxLength={128} required
            aria-describedby="password-hint" />
          <small id="password-hint">{labels.passwordHint}</small>
        </div>
        {state?.error ? <p className="id-alert" role="alert">{state.error}</p> : null}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </button>
      </form>
    </>
  );
}
