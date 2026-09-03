/**
 * Resolve the origin used for authentication redirects.
 *
 * In production, request headers are not trusted because a forged Host header
 * could turn a logout or OAuth failure into an attacker-controlled redirect.
 * Local development may use the request origin when no canonical URL exists.
 */
export function resolveSiteOrigin(requestUrl: URL): string | null {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      const protocolAllowed =
        parsed.protocol === 'https:' ||
        (process.env.NODE_ENV !== 'production' && parsed.protocol === 'http:');
      if (protocolAllowed && !parsed.username && !parsed.password) {
        return parsed.origin;
      }
    } catch {
      // Invalid deployment configuration is handled below without exposing it.
    }
  }

  // Demo mode may relax data access, but it must never relax redirect origin
  // validation in a production deployment.
  return process.env.NODE_ENV !== 'production' ? requestUrl.origin : null;
}
