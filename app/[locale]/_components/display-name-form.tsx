"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { changeDisplayNameAction } from "../actions";

type Labels = Record<"heading" | "displayName" | "hint" | "submit" | "pending", string>;

export function DisplayNameForm({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [state, action, pending] = useActionState(changeDisplayNameAction, undefined);

  return (
    <section className="id-section" aria-labelledby="display-name-heading">
      <h2 id="display-name-heading">{labels.heading}</h2>
      <form className="id-form" action={action}>
        <input type="hidden" name="locale" value={locale} />
        <div className="id-field">
          <label htmlFor="new-display-name">{labels.displayName}</label>
          <input id="new-display-name" name="displayName" autoComplete="nickname" maxLength={50} required
            defaultValue={state?.fields?.displayName} aria-describedby="new-display-name-hint" />
          <small id="new-display-name-hint">{labels.hint}</small>
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
