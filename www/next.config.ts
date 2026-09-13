import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import webpack from 'webpack';

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
  serverExternalPackages: ['subconverter-wasm', '../pkg'],

  // Webpack config to support WASM
  webpack: (config, { isServer, dev }) => {
    console.log(`⚙️ Configuring webpack (isServer: ${isServer}, dev: ${dev})`);

    // Support for WebAssembly
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
      layers: true,
      topLevelAwait: true,
    };

    // Configure WASM output location
    if (config.output) {
      // Ensure WASM is properly emitted to a predictable location
      config.output.webassemblyModuleFilename = isServer
        ? '../static/wasm/[modulehash].wasm' // Server build
        : 'static/wasm/[modulehash].wasm'; // Client build
    }

    // Define environment variable to help with debugging WASM loading
    config.plugins = config.plugins || [];
    config.plugins.push(
      new webpack.DefinePlugin({
        'process.env.WASM_DEBUG': JSON.stringify('true'),
        'process.env.DEPLOY_ENV': JSON.stringify(deployEnv),
      }),
    );

    // Make sure we don't interfere with the existing loaders
    return config;
  },
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
