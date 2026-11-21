"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { resetPasswordAction } from "../actions";

type Labels = Record<
  "heading" | "lead" | "password" | "hint" | "submit" | "pending" | "invalidHeading" | "invalidBody" | "forgotLink",
  string
>;

/** On success the action redirects to the login page; a link used meanwhile shows the invalid screen. */
export function ResetForm({
  locale,
  token,
  forgotHref,
  labels,
}: {
  locale: Locale;
  token: string;
  forgotHref: string;
  labels: Labels;
}) {
  const [state, action, pending] = useActionState(resetPasswordAction, undefined);

  if (state?.invalidLink) return <InvalidResetLink forgotHref={forgotHref} labels={labels} />;

  return (
    <>
      <h1>{labels.heading}</h1>
      <p className="id-lead">{labels.lead}</p>
      <form className="id-form" action={action}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <div className="id-field">
          <label htmlFor="password">{labels.password}</label>
          <input id="password" name="password" type="password" autoComplete="new-password" maxLength={128} required
            aria-describedby="password-hint" />
          <small id="password-hint">{labels.hint}</small>
        </div>
        {state?.error ? <p className="id-alert" role="alert">{state.error}</p> : null}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? labels.pending : labels.submit}
        </button>
      </form>
    </>
  );
}

export function InvalidResetLink({
  forgotHref,
  labels,
}: {
  forgotHref: string;
  labels: Pick<Labels, "invalidHeading" | "invalidBody" | "forgotLink">;
}) {
  return (
    <>
      <h1>{labels.invalidHeading}</h1>
      <p className="id-lead">{labels.invalidBody}</p>
      <p className="id-links">
        <a href={forgotHref}>{labels.forgotLink}</a>
      </p>
    </>
  );
}
