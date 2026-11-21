"use client";

import { useActionState } from "react";
import type { Locale } from "@/i18n/routing";
import { resendVerificationAction } from "../actions";

export function ResendForm({ locale, label }: { locale: Locale; label: string }) {
  const [state, action, pending] = useActionState(resendVerificationAction, undefined);

  return (
    <form className="id-form" action={action}>
      <input type="hidden" name="locale" value={locale} />
      {state?.notice ? <p className="id-notice" role="status">{state.notice}</p> : null}
      {state?.error ? <p className="id-alert" role="alert">{state.error}</p> : null}
      <button type="submit" className="button primary" disabled={pending}>{label}</button>
    </form>
  );
}
