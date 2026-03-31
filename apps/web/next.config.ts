import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@rockbed/api", "@rockbed/shared", "@rockbed/db"],
};

export default nextConfig;
