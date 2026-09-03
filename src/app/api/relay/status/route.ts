import { NextResponse } from "next/server";
import { peekRelay, postRelayTest } from "@/lib/relay-status";
import { pullRelayIntoIngest } from "@/lib/espn-relay";
import { pullRanksRelayIntoIngest } from "@/lib/ranks-relay";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const peek = await peekRelay();
  return NextResponse.json({ ok: true, ...peek });
}

export async function POST() {
  const posted = await postRelayTest();
  // Pull so listen can see the ESPN heartbeat (0 picks — never marks players taken).
  await pullRelayIntoIngest();
  await pullRanksRelayIntoIngest();
  const peek = await peekRelay();
  return NextResponse.json({
    ok: posted.espnPosted || posted.ranksPosted,
    ...posted,
    ...peek,
  });
}
