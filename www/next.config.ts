import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();

let deployEnv: 'standard' | 'cloudflare' | 'netlify' | 'vercel' = 'standard';

// Detect environments
if (
  process.env.NETLIFY === 'true' ||
  process.env.CONTEXT === 'production' ||
  process.env.NETLIFY_LOCAL === 'true' ||
  process.env.DEPLOY_URL?.includes('netlify')
) {
  deployEnv = 'netlify';
} else if (process.env.VERCEL === 'true') {
  deployEnv = 'vercel';
}

// Log environment info
console.log('✅ Deploy environment:', deployEnv);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Allows importing wasm files from pkg directory
  // transpilePackages: ['subconverter-wasm'],

  // Using serverExternalPackages to tell Next.js to resolve the WASM module at runtime
  // This ensures proper WASM loading in server environments like Netlify
  serverExternalPackages: ['subconverter-wasm'],

  async rewrites() {
    return [
      // Rewrite all API calls to the pages/api directory
      {
        source: '/api/:path*',
        destination: '/api/:path*',
      },
    ];
  },
};

export default withNextIntl(nextConfig);
