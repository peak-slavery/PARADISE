import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Ei Point — control plane for the Ei Flow bot network',
    template: '%s · Ei Point',
  },
  description:
    'Ei Point runs eight isolated Discord bots — Shanks, Sanji, Zoro, Boa Hancock, Nami, Luffy, Niko Robin and Cyrene — behind one control plane.',
  applicationName: 'Ei Point',
  keywords: [
    'Discord bot',
    'moderation',
    'antinuke',
    'leveling',
    'server management',
    'control plane',
  ],
  openGraph: {
    title: 'Ei Point',
    description:
      'One control plane for eight independent Discord bots. Config in Postgres, activity in Mongo, zero shared failure domains.',
    type: 'website',
    siteName: 'Ei Point',
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#EEF1F6',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="light">
      <body className="min-h-screen bg-base font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
