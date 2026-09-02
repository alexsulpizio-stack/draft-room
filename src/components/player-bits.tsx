import { cn } from "@/lib/utils";
import { isMissingRank } from "@/lib/draft";
import { playerSublineText } from "@/lib/player-display";
import type { Injury, Player, Position } from "@/lib/types";

export const POS_CLASS: Record<Position, string> = {
  QB: "bg-violet-100 text-violet-800 border-violet-200",
  RB: "bg-sky-100 text-sky-800 border-sky-200",
  WR: "bg-emerald-100 text-emerald-800 border-emerald-200",
  TE: "bg-amber-100 text-amber-800 border-amber-200",
  K: "bg-zinc-100 text-zinc-700 border-zinc-200",
  DST: "bg-rose-100 text-rose-800 border-rose-200",
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
  if (isMissingRank(fp) || isMissingRank(ds)) {
    return <span className="font-mono text-xs text-muted-foreground">—</span>;
  }
  const gap = fp - ds;
  if (fp === ds) {
    return <span className="font-mono text-xs text-muted-foreground">even</span>;
  }
  const dsAhead = gap > 0;
  return (
    <span
      className={cn(
        "font-mono text-xs font-medium",
        dsAhead ? "text-gold" : "text-sky-700"
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
      ? "bg-red-100 text-red-800 border-red-200"
      : injury === "questionable"
        ? "bg-orange-100 text-orange-800 border-orange-200"
        : "bg-yellow-100 text-yellow-800 border-yellow-200";
  return (
    <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase", color)}>
      {label}
    </span>
  );
}

export { formatNflTeam, playerSublineText } from "@/lib/player-display";

export function PlayerSubline({
  player,
  sleeper,
  className,
}: {
  player: Player;
  sleeper?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("text-[11px] text-muted-foreground", className)}>
      {playerSublineText(player)}
      {sleeper ? " · sleeper" : ""}
    </span>
  );
}

export function PlayerName({ player }: { player: Player }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium leading-tight">{player.name}</span>
      <PlayerSubline player={player} />
    </span>
  );
}
