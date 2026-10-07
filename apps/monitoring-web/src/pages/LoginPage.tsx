import { FormEvent, useState } from "react";
import { MfaEnrollmentError, MfaRequiredError, useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login, completeMfa } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.includes("@") || password.length < 12) {
      setError("Enter the operator email and password.");
      return;
    }
    setPending(true);
    try {
      if (mfaToken) {
        await completeMfa(mfaToken, code);
        return;
      }
      await login(email, password);
    } catch (caught) {
      if (caught instanceof MfaEnrollmentError) {
        setMfaToken(caught.mfaToken);
        setEnrolling({ secret: caught.secret, otpauth: caught.otpauth });
        setError(null);
        return;
      }
      if (caught instanceof MfaRequiredError) {
        setMfaToken(caught.mfaToken);
        setEnrolling(null);
        setError(null);
        return;
      }
      setError(caught instanceof Error ? caught.message : "Sign-in failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-2xl border border-line bg-panel p-8">
        <p className="text-sm uppercase tracking-[0.2em] text-warn">Guardian</p>
        <h1 className="mt-2 text-3xl font-semibold">Monitoring hub</h1>
        <p className="mt-3 text-sm text-slate-300">
          Operator sign-in. This screen does not create personal safety accounts.
        </p>
        <label className="mt-6 block text-sm" htmlFor="email">
          Email
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-3"
          />
        </label>
        <label className="mt-4 block text-sm" htmlFor="password">
          Password
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-3"
          />
        </label>
        {enrolling ? (
          <div className="mt-4 space-y-2 text-sm">
            <p>Scan this otpauth URL in an authenticator, or type the secret. The secret is shown once.</p>
            <p className="break-all rounded-lg border border-line bg-ink p-2 font-mono text-xs">{enrolling.otpauth}</p>
            <p className="break-all font-mono text-xs">Secret {enrolling.secret}</p>
          </div>
        ) : null}
        {mfaToken ? (
          <label className="mt-4 block text-sm" htmlFor="code">
            Authenticator code
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-ink px-3 py-3"
            />
          </label>
        ) : null}
        <p className="mt-3 text-xs text-slate-400">
          ADMIN, SUPERVISOR, MONITOR OPERATOR, and RESPONDER accounts must enroll an authenticator on first sign-in.
        </p>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-sos">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-6 w-full rounded-lg bg-slate-100 px-4 py-3 font-semibold text-ink disabled:opacity-60"
        >
          {pending ? "Signing in" : mfaToken ? "Confirm code" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
