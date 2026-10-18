/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets the app import ../shared (canonical.ts, fixtures) through the @shared/* alias.
  experimental: { externalDir: true },
  webpack: (config) => {
    // @base-org/account -> @coinbase/cdp-sdk imports x402 payment packages it lists as optional.
    // We never use its subscription/x402 features, so those imports resolve to empty modules.
    for (const m of ["@x402/core/client", "@x402/evm", "@x402/evm/exact/client", "@x402/evm/upto/client", "@x402/svm/exact/client"]) {
      config.resolve.alias[m] = false;
    }
    return config;
  },
};
export default nextConfig;
