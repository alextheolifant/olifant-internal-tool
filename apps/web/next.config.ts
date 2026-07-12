import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  experimental: {
    // Default is 30s — the AI Copilot's longer replies (e.g. Marketing Plan,
    // near max_tokens) can take longer than that to generate, which killed
    // the proxied request mid-flight (ECONNRESET) before it could finish.
    proxyTimeout: 120_000,
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_URL ?? "http://localhost:3001"}/:path*`,
      },
    ];
  },
};

export default nextConfig;
