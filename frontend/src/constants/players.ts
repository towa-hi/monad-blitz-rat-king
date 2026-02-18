/** A single player entry in the player list. */
export interface PlayerEntry {
  /** Unique identifier. */
  readonly id: number;
  /** Display name. */
  readonly name: string;
  /** Current score. */
  readonly score: number;
  /** Whether this entry is the local player. */
  readonly isYou: boolean;
  /** Path to the player's portrait image. */
  readonly portrait: string;
}

/** Index of the local player in the list. */
const LOCAL_PLAYER_INDEX = 2;

/** Number of available rat portrait assets. */
const PORTRAIT_COUNT = 28;

/** Twenty dummy player entries for the scrollable left panel. */
export const PLAYER_ENTRIES: PlayerEntry[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: i === LOCAL_PLAYER_INDEX ? `Rat #${i + 1} (You)` : `Rat #${i + 1}`,
  score: Math.floor(1000 - i * 42),
  isYou: i === LOCAL_PLAYER_INDEX,
  portrait: `/rats_${(i % PORTRAIT_COUNT) + 1}.png`,
}));
