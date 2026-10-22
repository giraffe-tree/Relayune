import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  // The release wrapper audits these maps privately, then removes them from out.
  productionBrowserSourceMaps: process.env.RELAY_LICENSE_PROVENANCE === "1",
  experimental: {
    cpus: 1,
  },
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
