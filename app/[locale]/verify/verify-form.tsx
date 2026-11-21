"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { confirmEmailAction, type VerifyState } from "../actions";

type Outcome = NonNullable<VerifyState>["outcome"];
type Screen = { heading: string; body: string };

/**
 * The link only opens this screen; the address is confirmed when the button posts the token
 * (a GET from a mail scanner or preview must not confirm anything).
 */
export function VerifyForm({
  locale,
  token,
  prompt,
  submit,
  pending: pendingLabel,
  outcomes,
  accountHref,
  accountLabel,
}: {
  locale: Locale;
  token: string;
  prompt: Screen;
  submit: string;
  pending: string;
  outcomes: Record<Outcome, Screen>;
  accountHref: string;
  accountLabel: string;
}) {
  const [state, action, pending] = useActionState(confirmEmailAction, undefined);

  if (state) return <VerifyOutcome screen={outcomes[state.outcome]} accountHref={accountHref} accountLabel={accountLabel} />;

  return (
    <>
      <h1>{prompt.heading}</h1>
      <p className="id-lead">{prompt.body}</p>
      <form className="id-form" action={action}>
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="token" value={token} />
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? pendingLabel : submit}
        </button>
      </form>
    </>
  );
}

export function VerifyOutcome({
  screen,
  accountHref,
  accountLabel,
}: {
  screen: Screen;
  accountHref: string;
  accountLabel: string;
}) {
  return (
    <>
      <h1>{screen.heading}</h1>
      <p className="id-lead">{screen.body}</p>
      <p className="id-links">
        <a href={accountHref}>{accountLabel}</a>
      </p>
    </>
  );
}
