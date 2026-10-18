/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets the app import ../shared (canonical.ts, fixtures) through the @shared/* alias.
  experimental: { externalDir: true },
};
export default nextConfig;
