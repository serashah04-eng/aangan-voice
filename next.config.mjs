/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Tests, scripts and eval tooling are not part of the deployed app.
  outputFileTracingExcludes: { '*': ['tests/**', 'scripts/**', 'eval/**', 'docs/**'] },
};

export default nextConfig;
