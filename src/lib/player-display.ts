import { formatSourceRank } from "./draft";
import { isUnknownNflTeam } from "./espn";
import type { Player } from "./types";

export function formatNflTeam(team: string | undefined): string {
  return isUnknownNflTeam(team) ? "—" : (team as string).trim();
}

/** ESPN ADP · team · bye — never "ESPN -1" or "bye 0". */
export function playerSublineText(player: Player): string {
  const adp = formatSourceRank(player.adp);
  const team = formatNflTeam(player.team);
  const head = team === "—" ? `ESPN ${adp}` : `ESPN ${adp} ${team}`;
  return player.bye > 0 ? `${head} · bye ${player.bye}` : head;
}
