import { FormEvent, useState } from "react";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
      await login(email, password);
    } catch (caught) {
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
          {pending ? "Signing in" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
