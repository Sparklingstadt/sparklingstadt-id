"use client";

import QRCode from "qrcode";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

type Labels = Record<
  | "heading" | "lead" | "on" | "off" | "password" | "enable" | "scan" | "qrAlt" | "manual" | "code" | "confirm"
  | "backupHeading" | "backupLead" | "regenerate" | "disable" | "pending" | "failed" | "wrongPassword" | "wrongCode"
  | "throttled",
  string
>;

type Setup = { uri: string; secret: string; qr: string; backupCodes: string[] };
type ApiError = { status: number; code?: string } | null;

/**
 * Two-factor authentication on the account page. On: the password, then the QR code (and the key to type in), then
 * one code from the app; the backup codes are shown then, once. They can be made again later. Off: the password.
 * Every step here takes the password, so none of them asks for a recent sign-in.
 */
export function TwoFactorSection({ enabled: initiallyEnabled, labels }: { enabled: boolean; labels: Labels }) {
  const [enabled, setEnabled] = useState(initiallyEnabled);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  // Shown once: after turning on or after making new ones, until the page is left.
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function fail(error: NonNullable<ApiError>) {
    if (error.status === 429) setMessage(labels.throttled);
    else if (error.code === "INVALID_PASSWORD") setMessage(labels.wrongPassword);
    else if (error.code === "INVALID_CODE") setMessage(labels.wrongCode);
    else setMessage(labels.failed);
  }

  async function run(task: () => Promise<ApiError>) {
    setPending(true);
    setMessage(null);
    const error = await task();
    setPending(false);
    if (error) fail(error);
  }

  const start = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data || !("totpURI" in data) || !data.totpURI) return error ?? { status: 500 };
      const secret = new URL(data.totpURI).searchParams.get("secret") ?? "";
      const qr = await QRCode.toDataURL(data.totpURI, { margin: 1, width: 200 });
      setSetup({ uri: data.totpURI, secret, qr, backupCodes: data.backupCodes ?? [] });
      setPassword("");
      return null;
    });
  };

  const confirm = (event: React.FormEvent) => {
    event.preventDefault();
    return run(async () => {
      const { error } = await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (error) return error;
      setBackupCodes(setup?.backupCodes ?? []);
      setSetup(null);
      setCode("");
      setEnabled(true);
      return null;
    });
  };

  const regenerate = () =>
    run(async () => {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      if (error || !data) return error ?? { status: 500 };
      setBackupCodes(data.backupCodes);
      setPassword("");
      return null;
    });

  const disable = () =>
    run(async () => {
      const { error } = await authClient.twoFactor.disable({ password });
      if (error) return error;
      setEnabled(false);
      setBackupCodes(null);
      setPassword("");
      return null;
    });

  const alert = message ? <p className="id-alert" role="alert">{message}</p> : null;
  const passwordField = (
    <div className="id-field">
      <label htmlFor="two-factor-password">{labels.password}</label>
      <input id="two-factor-password" type="password" autoComplete="current-password" required value={password}
        onChange={(event) => setPassword(event.target.value)} />
    </div>
  );

  return (
    <section className="id-section" aria-labelledby="two-factor-heading">
      <h2 id="two-factor-heading">{labels.heading}</h2>
      <p>{labels.lead}</p>
      <p>{enabled ? labels.on : labels.off}</p>

      {backupCodes ? (
        <div className="id-notice">
          <h3>{labels.backupHeading}</h3>
          <p>{labels.backupLead}</p>
          <ul className="id-backup-codes">
            {backupCodes.map((backupCode) => (
              <li key={backupCode}><code data-testid="backup-code">{backupCode}</code></li>
            ))}
          </ul>
        </div>
      ) : null}

      {!enabled && setup ? (
        <form className="id-form" onSubmit={confirm}>
          <p>{labels.scan}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL made in the browser */}
          <img src={setup.qr} alt={labels.qrAlt} width={200} height={200} />
          <p>
            {labels.manual}{" "}
            <code data-testid="totp-secret" data-uri={setup.uri}>{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
          </p>
          <div className="id-field">
            <label htmlFor="two-factor-code">{labels.code}</label>
            <input id="two-factor-code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}"
              maxLength={6} required value={code} onChange={(event) => setCode(event.target.value)} />
          </div>
          {alert}
          <button type="submit" className="button primary" disabled={pending}>
            {pending ? labels.pending : labels.confirm}
          </button>
        </form>
      ) : null}

      {!enabled && !setup ? (
        <form className="id-form" onSubmit={start}>
          {passwordField}
          {alert}
          <button type="submit" className="button primary" disabled={pending}>
            {pending ? labels.pending : labels.enable}
          </button>
        </form>
      ) : null}

      {enabled ? (
        <form className="id-form" onSubmit={(event) => event.preventDefault()}>
          {passwordField}
          {alert}
          <button type="button" className="button" disabled={pending || password === ""} onClick={regenerate}>
            {pending ? labels.pending : labels.regenerate}
          </button>
          <button type="button" className="button" disabled={pending || password === ""} onClick={disable}>
            {pending ? labels.pending : labels.disable}
          </button>
        </form>
      ) : null}
    </section>
  );
}
