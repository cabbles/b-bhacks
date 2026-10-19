/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets the app import ../shared (canonical.ts, fixtures) through the @shared/* alias.
  experimental: { externalDir: true },
  // Retired pages: old links land on their replacements.
  async redirects() {
    return [
      { source: "/integrity", destination: "/how-it-works", permanent: true },
      { source: "/fool", destination: "/how-it-works", permanent: true },
      { source: "/split", destination: "/cohorts", permanent: true },
    ];
  },
};
export default nextConfig;
