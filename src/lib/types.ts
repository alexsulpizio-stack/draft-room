export type Position = "QB" | "RB" | "WR" | "TE" | "K" | "DST";
export type Scoring = "ppr" | "half" | "standard";
export type Injury = "watch" | "questionable" | "out";
export type DraftType = "snake" | "linear";

export interface Player {
  id: string;
  name: string;
  team: string;
  pos: Position;
  bye: number;
  fpRank: number;
  dsRank: number;
  adp: number;
  proj: number;
  dsValue?: number;
  injury?: Injury;
  note?: string;
  tags: string[];
}

export interface LeagueSettings {
  leagueName: string;
  espnLeagueId: string;
  teams: number;
  rounds: number;
  slot: number;
  scoring: Scoring;
  superflex: boolean;
  firstDownBonus: boolean;
  dsWeight: number;
  draftType: DraftType;
  teamNames: string[];
  roster: {
    qb: number;
    rb: number;
    wr: number;
    te: number;
    flex: number;
    rbwr: number;
    k: number;
    dst: number;
    bench: number;
    ir: number;
  };
}

export interface DraftPick {
  overall: number;
  team: number;
  playerId: string;
}

export interface Recommendation {
  player: Player;
  score: number;
  reasons: string[];
  wait: "now" | "borderline" | "can-wait";
}

/** JFL 28 on ESPN — leagueId 1361349772. Snake, Thu Sep 3 2026 7:00 PM EDT. */
export const DEFAULT_SETTINGS: LeagueSettings = {
  leagueName: "JFL 28",
  espnLeagueId: "1361349772",
  teams: 12,
  rounds: 14,
  slot: 1,
  scoring: "half",
  superflex: false,
  firstDownBonus: true,
  dsWeight: 50,
  draftType: "snake",
  teamNames: [],
  roster: {
    qb: 1,
    rb: 1,
    wr: 3,
    te: 1,
    flex: 0,
    rbwr: 1,
    k: 1,
    dst: 0,
    bench: 6,
    ir: 2,
  },
};
