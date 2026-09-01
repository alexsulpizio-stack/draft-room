import { cn } from "@/lib/utils";
import type { Injury, Player, Position } from "@/lib/types";

export const POS_CLASS: Record<Position, string> = {
  QB: "bg-violet-500/15 text-violet-300 border-violet-400/25",
  RB: "bg-sky-500/15 text-sky-300 border-sky-400/25",
  WR: "bg-emerald-500/15 text-emerald-300 border-emerald-400/25",
  TE: "bg-amber-500/15 text-amber-300 border-amber-400/25",
  K: "bg-zinc-500/15 text-zinc-300 border-zinc-400/25",
  DST: "bg-rose-500/15 text-rose-300 border-rose-400/25",
};

export function PosBadge({ pos }: { pos: Position }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-9 items-center justify-center rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide",
        POS_CLASS[pos]
      )}
    >
      {pos}
    </span>
  );
}

export function GapChip({ fp, ds }: { fp: number; ds: number }) {
  const gap = fp - ds;
  if (Math.abs(gap) < 3) {
    return <span className="font-mono text-xs text-muted-foreground">even</span>;
  }
  const dsAhead = gap > 0;
  return (
    <span
      className={cn(
        "font-mono text-xs font-medium",
        dsAhead ? "text-gold" : "text-sky-300"
      )}
    >
      {dsAhead ? "DS" : "FP"} +{Math.abs(gap)}
    </span>
  );
}

export function InjuryDot({ injury }: { injury?: Injury }) {
  if (!injury) return null;
  const label = injury === "out" ? "OUT" : injury === "questionable" ? "Q" : "Watch";
  const color =
    injury === "out"
      ? "bg-red-500/20 text-red-300 border-red-500/30"
      : injury === "questionable"
        ? "bg-orange-500/20 text-orange-300 border-orange-500/30"
        : "bg-yellow-500/15 text-yellow-200 border-yellow-500/25";
  return (
    <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", color)}>
      {label}
    </span>
  );
}

export function PlayerName({ player }: { player: Player }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium leading-tight">{player.name}</span>
      <span className="text-[11px] text-muted-foreground">
        {player.team}
        {player.bye ? ` · Bye ${player.bye}` : ""}
      </span>
    </span>
  );
}
