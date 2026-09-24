import path from 'node:path';
import type { NextConfig } from 'next';
const config: NextConfig = {
  serverExternalPackages: ['@google-cloud/firestore', 'mongodb', 'pg', 'stripe'],
  turbopack: { root: path.resolve(process.cwd()) },
  webpack(config) {
    // NodeNext uses .js specifiers in TypeScript source. Resolve source when bundling the example.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};
export default config;
