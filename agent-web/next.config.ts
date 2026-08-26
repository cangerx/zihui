import type { NextConfig } from "next";

const imageHosts = (process.env.NEXT_PUBLIC_IMAGE_HOSTS || "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      ...imageHosts.map((hostname) => ({ protocol: "https" as const, hostname })),
    ],
  },
};

export default nextConfig;
