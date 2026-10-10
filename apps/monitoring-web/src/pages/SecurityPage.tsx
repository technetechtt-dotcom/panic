import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function SecurityPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setup = useMutation({
    mutationFn: () => api<{ secret: string; otpauth: string }>("/api/v1/auth/mfa/setup", token, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: (data) => {
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
      await api("/api/v1/auth/mfa/confirm", token, { method: "POST", body: JSON.stringify({ code }) });
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code was not accepted.");
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-3xl font-semibold">Security / MFA</h1>
      <p className="mt-2 text-sm text-slate-300">
        Operators enroll an authenticator. Recovery is the authenticator secret shown once, not a printed code sheet.
      </p>
      <button
        type="button"
        className="mt-6 rounded-lg bg-slate-100 px-4 py-3 font-semibold text-ink"
        onClick={() => setup.mutate()}
      >
        Start MFA setup
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
      {error ? <p className="mt-4 text-sm text-sos">{error}</p> : null}
    </main>
  );
}
