import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function SecurityPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [password, setPassword] = useState("");
  const [currentCode, setCurrentCode] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const setup = useMutation({
    mutationFn: () => api<{ secret: string; otpauth: string }>("/api/v1/auth/mfa/setup", token, { method: "POST", body: JSON.stringify({ password, currentCode: currentCode || undefined }) }),
    onSuccess: (data) => {
      setPassword("");
      setCurrentCode("");
      setSecret(data.secret);
      setOtpauth(data.otpauth);
      setError(null);
    },
    onError: (caught: unknown) => setError(caught instanceof Error ? caught.message : "MFA setup failed."),
  });

  async function confirm(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const result = await api<{ enabled: boolean; recoveryCodes: string[] }>("/api/v1/auth/mfa/confirm", token, { method: "POST", body: JSON.stringify({ code }) });
      setRecoveryCodes(result.recoveryCodes ?? []);
      setDone(true);
      setSecret(null);
      setOtpauth(null);
      setCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code was not accepted.");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-3xl font-semibold">Security / MFA</h1>
      <p className="mt-2 text-sm text-slate-300">
        Operators enroll an authenticator. After verification Guardian generates one-time recovery codes; save them securely because they are shown only once.
      </p>
      <label className="mt-6 block">Current password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-ink p-3" /></label>
      <label className="mt-3 block">Current authenticator or recovery code (required for replacement)<input autoComplete="one-time-code" value={currentCode} onChange={e => setCurrentCode(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-ink p-3" /></label>
      <button
        type="button"
        className="mt-6 rounded-lg bg-slate-100 px-4 py-3 font-semibold text-ink"
        disabled={!password || setup.isPending}
        onClick={() => setup.mutate()}
      >
        Set up / Replace authenticator
      </button>
      {otpauth ? (
        <section className="mt-6 space-y-3 rounded-2xl border border-line bg-panel p-4 text-sm">
          <p>Scan or paste this otpauth URL.</p>
          <p className="break-all font-mono text-xs">{otpauth}</p>
          <p className="break-all font-mono text-xs">Secret {secret}</p>
          <form onSubmit={confirm}>
            <label className="block" htmlFor="mfa-code">
              Verification code
              <input
                id="mfa-code"
                inputMode="numeric"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-3"
              />
            </label>
            <button type="submit" className="mt-3 rounded-lg border border-line px-4 py-2 font-semibold">
              Confirm MFA
            </button>
          </form>
        </section>
      ) : null}
      {done ? <p className="mt-4 text-sm">Authenticator is enabled for this operator.</p> : null}
      {recoveryCodes.length ? (
        <section className="mt-4 rounded-2xl border border-warn bg-panel p-4" aria-live="polite">
          <h2 className="font-semibold">One-time recovery codes</h2>
          <p className="mt-1 text-sm text-slate-300">Store these offline. Each code works once and Guardian does not show this set again.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {recoveryCodes.map((item) => <li key={item} className="rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm">{item}</li>)}
          </ul>
        </section>
      ) : null}
      {error ? <p className="mt-4 text-sm text-sos">{error}</p> : null}
    </main>
  );
}
