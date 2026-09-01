"use client";

import dynamic from "next/dynamic";

const DraftApp = dynamic(() => import("@/components/draft-app").then((m) => m.DraftApp), {
  ssr: false,
  loading: () => (
    <div className="grid min-h-full place-items-center p-8">
      <div className="text-center">
        <p className="font-display text-3xl tracking-wide text-primary">Draft Room</p>
        <p className="mt-2 text-sm text-muted-foreground">Loading your 2026 board…</p>
      </div>
    </div>
  ),
});

export default function Home() {
  return <DraftApp />;
}
