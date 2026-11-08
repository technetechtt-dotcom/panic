import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

interface MfaStatus { enabled:boolean; pending:boolean; pendingExpiresAt:string|null }

export function SecurityPage() {
  const { session } = useAuth();
  const token = session?.accessToken ?? null;
  const qc = useQueryClient();
  const status = useQuery({ queryKey:["mfa-status"], queryFn:()=>api<MfaStatus>("/api/v1/auth/mfa/status",token) });
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [currentCode, setCurrentCode] = useState("");
  const [code, setCode] = useState("");
  const [done, setDone] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const setup = useMutation({
    mutationFn: () => api<{ secret: string; otpauth: string; replacing:boolean; expiresAt:string }>("/api/v1/auth/mfa/setup", token, {
      method: "POST",
      body: JSON.stringify(currentCode.trim() ? { currentCode: currentCode.trim() } : {}),
    }),
    onSuccess: (data) => {
      setSecret(data.secret);
      setOtpauth(data.otpauth);
      setCode("");
      setCurrentCode("");
      setDone(false);
      setError(null);
      void qc.invalidateQueries({queryKey:["mfa-status"]});
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
      await qc.invalidateQueries({queryKey:["mfa-status"]});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That code was not accepted.");
    }
  }

  const enabled=status.data?.enabled===true;
  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <h1 className="text-3xl font-semibold">Security / MFA</h1>
      <p className="mt-2 text-sm text-slate-300">
        {enabled
          ? "MFA is enabled. Replacing the authenticator requires a fresh code from the current authenticator and does not disable the current secret until the replacement is verified."
          : "Enroll an authenticator. Guardian activates the secret only after the new authenticator code is verified."}
      </p>
      {enabled ? (
        <label className="mt-5 block text-sm" htmlFor="current-mfa-code">
          Current authenticator code
          <input id="current-mfa-code" inputMode="numeric" maxLength={6} value={currentCode} onChange={e=>setCurrentCode(e.target.value.replace(/\D/g,"").slice(0,6))} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-3" />
        </label>
      ) : null}
      <button
        type="button"
        disabled={setup.isPending || (enabled && currentCode.length!==6)}
        className="mt-4 rounded-lg bg-slate-100 px-4 py-3 font-semibold text-ink disabled:opacity-40"
        onClick={() => setup.mutate()}
      >
        {setup.isPending ? "Preparing…" : enabled ? "Replace authenticator" : "Start MFA setup"}
      </button>
      {status.data?.pending ? <p className="mt-3 text-sm text-warn">A replacement is pending verification. The current authenticator remains active.</p>:null}
      {otpauth ? (
        <section className="mt-6 space-y-3 rounded-2xl border border-line bg-panel p-4 text-sm">
          <p>Add the new Guardian secret to your authenticator, then enter a code from the new entry. The old authenticator stays valid until this succeeds.</p>
          <p className="break-all font-mono text-xs">{otpauth}</p>
          <p className="break-all font-mono text-xs">Secret {secret}</p>
          <form onSubmit={confirm}>
            <label className="block" htmlFor="mfa-code">
              New authenticator verification code
              <input id="mfa-code" inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g,"").slice(0,6))} className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-3" />
            </label>
            <button type="submit" disabled={code.length!==6} className="mt-3 rounded-lg border border-line px-4 py-2 font-semibold disabled:opacity-40">
              Confirm new authenticator
            </button>
          </form>
        </section>
      ) : null}
      {done ? <p className="mt-4 text-sm">Authenticator is enabled. Previous authenticator secrets are no longer accepted.</p> : null}
      {recoveryCodes.length ? (
        <section className="mt-4 rounded-2xl border border-warn bg-panel p-4" aria-live="polite">
          <h2 className="font-semibold">One-time recovery codes</h2>
          <p className="mt-1 text-sm text-slate-300">Store these offline. Each code works once and Guardian does not show this set again.</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {recoveryCodes.map((item) => <li key={item} className="rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm">{item}</li>)}
          </ul>
        </section>
      ) : null}
      {error ? <p className="mt-4 text-sm text-sos" role="alert">{error}</p> : null}
    </main>
  );
}
