import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Vercel build checks only the Next.js application surface. Cloudflare
  // worker files keep their own types and continue to build through Vinext.
  typescript: {
    tsconfigPath: "tsconfig.vercel.json",
  },
};

export default nextConfig;
