import { Link } from "react-router-dom";

export function ForbiddenPage() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <section className="max-w-lg text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-warn">403</p>
        <h1 className="mt-2 text-3xl font-semibold">You don&apos;t have access</h1>
        <p className="mt-3 text-sm text-slate-300">This page is limited to another monitoring role. The incident list stays available.</p>
        <Link to="/" className="mt-6 inline-block rounded-lg border border-line px-4 py-2 text-sm">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4">
      <section className="max-w-lg text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-warn">404</p>
        <h1 className="mt-2 text-3xl font-semibold">Page not found</h1>
        <p className="mt-3 text-sm text-slate-300">That route is not part of the monitoring hub.</p>
        <Link to="/" className="mt-6 inline-block rounded-lg border border-line px-4 py-2 text-sm">
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}
