import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function gitShortSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };
const gitSha = gitShortSha();
const buildTime = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
const buildLabel = `${pkg.version} · ${gitSha}`;

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_GIT_SHA: gitSha,
    NEXT_PUBLIC_BUILD_TIME: buildTime,
    NEXT_PUBLIC_BUILD_LABEL: buildLabel,
    // Bake configured public URL into the client bundle when set (Cloud preview).
    ...(process.env.DRAFT_ROOM_PUBLIC_URL
      ? { NEXT_PUBLIC_DRAFT_ROOM_URL: process.env.DRAFT_ROOM_PUBLIC_URL }
      : {}),
    ...(process.env.NEXT_PUBLIC_DRAFT_ROOM_URL
      ? { NEXT_PUBLIC_DRAFT_ROOM_URL: process.env.NEXT_PUBLIC_DRAFT_ROOM_URL }
      : {}),
    ...(process.env.NEXT_PUBLIC_APP_URL
      ? { NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL }
      : {}),
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "localhost",
    "espn.com",
    "*.espn.com",
    "fantasy.espn.com",
    "www.espn.com",
    "fantasypros.com",
    "*.fantasypros.com",
    "draftwizard.fantasypros.com",
    "draftsharks.com",
    "*.draftsharks.com",
    "www.draftsharks.com",
  ],
};

export default nextConfig;
