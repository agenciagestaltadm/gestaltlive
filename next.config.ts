import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Servidor próprio (npm run dev/start, Docker): a API e o Socket.IO rodam em server/index.ts e o Next.js
  // cuida da interface. Na Vercel, a API roda como função em src/app/api/[...path]/route.ts.
  poweredByHeader: false,
  serverExternalPackages: ["pg", "@electric-sql/pglite", "sharp", "socket.io"],
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
