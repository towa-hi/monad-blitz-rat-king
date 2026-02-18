import type { Address } from "viem";
import type { GameStateJson } from "../hooks/useGameState";

/** A single player entry in the player list. */
export interface PlayerEntry {
  /** Unique slot index (1-based). */
  readonly id: number;
  /** On-chain player address (not displayed, used for identity). */
  readonly address: Address | null;
  /** Display name. */
  readonly name: string;
  /** Current score. */
  readonly score: number;
  /** Whether this entry is the local player. */
  readonly isYou: boolean;
  /** Path to the player's portrait image. */
  readonly portrait: string;
  /** Whether this slot is occupied by a player. */
  readonly occupied: boolean;
}

/** Total number of player slots in the lobby grid. */
export const PLAYER_SLOT_COUNT = 20;

/** Number of available rat portrait assets. */
const PORTRAIT_COUNT = 28;

/**
 * Builds the player entry list from on-chain game state.
 * Occupied slots use real data from the contract; remaining slots are empty placeholders.
 *
 * @param gameState - Decoded game state from the contract, or null if unavailable.
 * @param localAddress - The connected wallet address, or null if not connected.
 * @returns Array of 20 player entries for the lobby grid.
 */
export function buildPlayerEntries(
  gameState: GameStateJson | null,
  localAddress: Address | null,
): PlayerEntry[] {
  const normalizedLocal = localAddress?.toLowerCase() ?? null;

  return Array.from({ length: PLAYER_SLOT_COUNT }, (_, i): PlayerEntry => {
    const playerState = gameState?.playerStates[i] ?? null;

    if (playerState === null) {
      return {
        id: i + 1,
        address: null,
        name: `Slot #${i + 1}`,
        score: 0,
        isYou: false,
        portrait: `/rats_${(i % PORTRAIT_COUNT) + 1}.png`,
        occupied: false,
      };
    }

    const isYou =
      normalizedLocal !== null &&
      playerState.player.toLowerCase() === normalizedLocal;

    return {
      id: i + 1,
      address: playerState.player,
      name: isYou ? `Rat #${i + 1} (You)` : `Rat #${i + 1}`,
      score: Number(playerState.score),
      isYou,
      portrait: `/rats_${(i % PORTRAIT_COUNT) + 1}.png`,
      occupied: true,
    };
  });
}
