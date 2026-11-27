"use client";

import { useState } from "react";
import type { Locale } from "@/i18n/routing";
import { authClient } from "@/lib/auth-client";
import { grantPasskeyAddAction } from "../actions";

type Labels = Record<"heading" | "lead" | "name" | "namePlaceholder" | "password" | "wrongPassword" | "throttled" | "add" | "pending" | "empty" | "delete" | "failed" | "unnamed", string>;

/**
 * The signed-in user's passkeys: named, listed, added and deleted here (any number of them). Adding one takes the
 * account password: the Server Action checks it and grants the registration, which the server then insists on.
 */
export function PasskeySection({ locale, labels, freshLoginHref }: { locale: Locale; labels: Labels; freshLoginHref: string }) {
  const { data: passkeys, refetch } = authClient.useListPasskeys();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const granted = await grantPasskeyAddAction(locale, password);
    if (granted !== "ok") {
      setPending(false);
      setMessage(granted === "throttled" ? labels.throttled : labels.wrongPassword);
      return;
    }
    const { error } = await authClient.passkey.addPasskey({ name: name.trim() || undefined });
    setPending(false);
    // Adding a credential needs a sign-in from the last 24 hours (Better Auth's freshAge): ask for one, then come back.
    if (error && "code" in error && error.code === "SESSION_NOT_FRESH") {
      window.location.assign(freshLoginHref);
      return;
    }
    if (error) {
      setMessage(labels.failed);
      return;
    }
    setName("");
    setPassword("");
    await refetch();
  }

  async function remove(id: string) {
    setMessage(null);
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) setMessage(labels.failed);
    else await refetch();
  }

  return (
    <section className="id-section" aria-labelledby="passkey-heading">
      <h2 id="passkey-heading">{labels.heading}</h2>
      <p>{labels.lead}</p>
      {passkeys && passkeys.length > 0 ? (
        <ul className="id-passkeys">
          {passkeys.map((passkey) => (
            <li key={passkey.id}>
              <span>{passkey.name || labels.unnamed}</span>{" "}
              <button type="button" className="button text" onClick={() => remove(passkey.id)}>
                {labels.delete}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p>{labels.empty}</p>
      )}
      <form className="id-form" onSubmit={add}>
        <div className="id-field">
          <label htmlFor="passkey-name">{labels.name}</label>
          <input id="passkey-name" type="text" maxLength={50} value={name} placeholder={labels.namePlaceholder}
            onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="id-field">
          <label htmlFor="passkey-password">{labels.password}</label>
          <input id="passkey-password" type="password" autoComplete="current-password" required value={password}
            onChange={(event) => setPassword(event.target.value)} />
        </div>
        {message ? <p className="id-alert" role="alert">{message}</p> : null}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? labels.pending : labels.add}
        </button>
      </form>
    </section>
  );
}
