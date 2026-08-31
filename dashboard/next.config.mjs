/** @type {import('next').NextConfig} */
const isSecureProduction =
  process.env.NODE_ENV === 'production' &&
  (process.env.VERCEL === '1' || process.env.NEXT_PUBLIC_SITE_URL?.startsWith('https://') === true);

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
];

if (isSecureProduction) {
  securityHeaders.push({
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  });
}

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.discordapp.com' },
      { protocol: 'https', hostname: 'media.discordapp.net' },
    ],
  },
  experimental: {
    // The MongoDB driver is server-only. Keeping it external stops Next from
    // trying to bundle it into route-handler output (and keeps it out of any
    // client graph entirely).
    serverComponentsExternalPackages: ['mongodb'],
  },
};

export default nextConfig;
