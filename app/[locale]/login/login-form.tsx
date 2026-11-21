"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { logInAction } from "../actions";

type Labels = Record<"email" | "password" | "submit" | "pending", string>;

export function LogInForm({ locale, next, labels }: { locale: Locale; next: string; labels: Labels }) {
  const [state, action, pending] = useActionState(logInAction, undefined);

  return (
    <form className="id-form" action={action}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={next} />
      <div className="id-field">
        <label htmlFor="email">{labels.email}</label>
        <input id="email" name="email" type="email" autoComplete="username" required
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
