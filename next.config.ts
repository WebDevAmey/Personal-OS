import type { NextConfig } from 'next';
// Relative import: next.config.ts is loaded before path aliases apply.
import { securityHeaders } from './lib/security/headers';

// Security headers and CSP trade-offs are documented in lib/security/headers.ts.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders() },
      // API responses are per-user; never let a shared cache keep them.
      { source: '/api/:path*', headers: [{ key: 'Cache-Control', value: 'private, no-store' }] },
    ];
  },
};

export default nextConfig;
