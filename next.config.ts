import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A API e o gateway de tempo real rodam no servidor Node próprio (server/index.ts).
  // O Next.js é responsável apenas pela interface.
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
