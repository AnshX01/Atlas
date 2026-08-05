/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.ELECTRON_BUILD === "true" ? "export" : undefined,
  trailingSlash: process.env.ELECTRON_BUILD === "true",
  images: {
    unoptimized: process.env.ELECTRON_BUILD === "true",
  },
  experimental: {},
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:8000",
  },
};

module.exports = nextConfig;
