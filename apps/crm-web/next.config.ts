import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@quantum-crm/auth", "@quantum-crm/config", "@quantum-crm/contracts"],
  turbopack: {},
};

export default nextConfig;
