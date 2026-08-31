import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-mesh opacity-80" />

      <div className="w-full max-w-md rounded-[2rem] glass-strong glass-sheen p-9">
        <p className="font-mono text-sm font-semibold text-accent-ink">404</p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
          Nothing lives here
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          That route doesn’t exist — or the server you asked for isn’t one you
          own.
        </p>
        <div className="mt-7 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link href="/dashboard" className="btn-neu-primary px-5 py-2.5">
            Go to your servers
          </Link>
          <Link href="/" className="btn-neu px-5 py-2.5">
            Back to overview
          </Link>
        </div>
      </div>
    </main>
  );
}
