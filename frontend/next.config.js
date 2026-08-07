/** @type {import('next').NextConfig} */
const nextConfig = {
  // Desktop app - always use static export for Electron
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  experimental: {},
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000",
  },
};

module.exports = nextConfig;
