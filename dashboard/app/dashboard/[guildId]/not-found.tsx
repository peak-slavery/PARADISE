import Link from 'next/link';

import { IconShield } from '@/components/ui/icons';

export default function GuildNotFound() {
  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-3xl glass glass-sheen p-8 text-center">
        <span
          className="mx-auto grid h-12 w-12 place-items-center rounded-2xl text-white"
          style={{
            background: 'linear-gradient(140deg, #f0863c 0%, #d9661a 100%)',
            boxShadow: '5px 5px 12px rgba(230,126,34,0.34), -3px -3px 8px rgba(255,255,255,0.9)',
          }}
        >
          <IconShield size={22} />
        </span>

        <h2 className="mt-5 text-lg font-semibold tracking-tight text-ink">
          Server unavailable
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-ink-soft">
          Either Ei Point isn’t in that guild yet, or it belongs to
          someone else. Row Level Security hides it either way.
        </p>

        <Link href="/dashboard" className="btn-neu-primary mt-6 inline-flex px-5 py-2.5">
          Back to your servers
        </Link>
      </div>
    </div>
  );
}
