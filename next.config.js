/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
    dirs: [], // Don't run ESLint on any directory
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  swcMinify: false,
  experimental: {
    forceSwcTransforms: true,
  },
  images: {
    unoptimized: true,
  }
}

module.exports = nextConfig
