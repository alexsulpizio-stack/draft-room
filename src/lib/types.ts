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
  teams: number;
  rounds: number;
  slot: number;
  scoring: Scoring;
  superflex: boolean;
  dsWeight: number;
  draftType: DraftType;
  teamNames: string[];
  roster: {
    qb: number;
    rb: number;
    wr: number;
    te: number;
    flex: number;
    k: number;
    dst: number;
    bench: number;
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

export const DEFAULT_SETTINGS: LeagueSettings = {
  teams: 12,
  rounds: 15,
  slot: 1,
  scoring: "ppr",
  superflex: false,
  dsWeight: 50,
  draftType: "snake",
  teamNames: [],
  roster: {
    qb: 1,
    rb: 2,
    wr: 2,
    te: 1,
    flex: 1,
    k: 1,
    dst: 1,
    bench: 6,
  },
};
