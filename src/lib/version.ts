/** App build identity — set at Next startup via next.config.ts env. */
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
export const GIT_SHA = process.env.NEXT_PUBLIC_GIT_SHA ?? "dev";
export const BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

/** Human-readable label, e.g. `0.1.1 · 3e9f169` */
export const BUILD_LABEL =
  process.env.NEXT_PUBLIC_BUILD_LABEL ?? `${APP_VERSION} · ${GIT_SHA}`;

export function buildTitle(): string {
  const parts = [`Draft Room v${APP_VERSION}`, `git ${GIT_SHA}`];
  if (BUILD_TIME) parts.push(`built ${BUILD_TIME}`);
  return parts.join(" · ");
}
