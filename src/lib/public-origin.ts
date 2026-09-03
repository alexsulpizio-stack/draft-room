/** localStorage key for operator-set Draft Room public URL (Cloud preview). */
export const PUBLIC_ORIGIN_STORAGE_KEY = "draft-room-public-origin";

export function readStoredPublicOrigin(): string {
  try {
    return (localStorage.getItem(PUBLIC_ORIGIN_STORAGE_KEY) || "").replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function writeStoredPublicOrigin(origin: string) {
  const cleaned = origin.trim().replace(/\/$/, "");
  try {
    if (!cleaned) localStorage.removeItem(PUBLIC_ORIGIN_STORAGE_KEY);
    else localStorage.setItem(PUBLIC_ORIGIN_STORAGE_KEY, cleaned);
  } catch {
    /* private mode */
  }
}

/** Env-baked public URL available in the browser bundle. */
export function envPublicOrigin(): string {
  return (
    process.env.NEXT_PUBLIC_DRAFT_ROOM_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  ).replace(/\/$/, "");
}
