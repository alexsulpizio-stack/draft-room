import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "espn.com",
    "*.espn.com",
    "fantasy.espn.com",
    "www.espn.com",
  ],
};

export default nextConfig;
