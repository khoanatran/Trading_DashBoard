const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['ffmpeg-static', 'ffprobe-static'],
  // Optimize for development hot reload
  webpack: (config, { dev, isServer }) => {
    config.resolve.alias['@'] = path.resolve(__dirname)
    if (dev && !isServer) {
      // Improve Fast Refresh reliability
      config.watchOptions = {
        poll: 1000, // Check for changes every second
        aggregateTimeout: 300,
      }
    }
    return config
  },
  // Enable Fast Refresh
  experimental: {
    // Fast Refresh should work by default in Next.js 15
  },
}

module.exports = nextConfig

