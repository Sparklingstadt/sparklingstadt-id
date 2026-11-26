"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type Labels = Record<"heading" | "lead" | "name" | "namePlaceholder" | "add" | "pending" | "empty" | "delete" | "failed" | "unnamed", string>;

/** The signed-in user's passkeys: named, listed, added and deleted here (any number of them). */
export function PasskeySection({ labels }: { labels: Labels }) {
  const { data: passkeys, refetch } = authClient.useListPasskeys();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setFailed(false);
    const { error } = await authClient.passkey.addPasskey({ name: name.trim() || undefined });
    setPending(false);
    if (error) {
      setFailed(true);
      return;
    }
    setName("");
    await refetch();
  }

  async function remove(id: string) {
    setFailed(false);
    const { error } = await authClient.passkey.deletePasskey({ id });
    if (error) setFailed(true);
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
        {failed ? <p className="id-alert" role="alert">{labels.failed}</p> : null}
        <button type="submit" className="button primary" disabled={pending}>
          {pending ? labels.pending : labels.add}
        </button>
      </form>
    </section>
  );
}
