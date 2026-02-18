import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { monadTestnet } from "viem/chains";
import {
  fetchCurrentGame,
  fetchDecodedGameStateDump,
} from "@shared/gameStateDump.ts";
import type { GameStateJson } from "@shared/gameStateDump.ts";
import { GAME_CONTRACT_ADDRESS } from "../config.ts";

export type { GameStateJson };

/** Default polling interval for refreshing game state (ms). */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
});

/**
 * Options for the useGameState hook.
 */
interface UseGameStateOptions {
  /** Polling interval in milliseconds. Defaults to 5 000 ms. */
  pollIntervalMs?: number;
}

/**
 * Result shape returned by the useGameState hook.
 */
interface UseGameStateResult {
  /** The latest decoded game state, or null while loading. */
  gameState: GameStateJson | null;
  /** The current game number read from the contract, or null while loading. */
  currentGame: number | null;
  /** Error message if the last fetch failed. */
  error: string | null;
  /** Whether an initial load is in progress. */
  loading: boolean;
  /** Manually trigger a refetch. */
  refetch: () => void;
}

/**
 * React hook that polls the on-chain game state dump for the current game.
 * First queries the contract's `currentGame` variable to determine which game
 * to fetch. If `currentGame` is less than 1 (no game created yet), the hook
 * skips the game state fetch and returns null.
 *
 * Automatically refreshes at the configured polling interval.
 *
 * @param options - Optional configuration (polling interval, etc.).
 * @returns The current game number, game state, loading flag, error, and a manual refetch function.
 */
export function useGameState(
  options?: UseGameStateOptions,
): UseGameStateResult {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const [gameState, setGameState] = useState<GameStateJson | null>(null);
  const [currentGameNumber, setCurrentGameNumber] = useState<number | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchState = useCallback(async (): Promise<void> => {
    try {
      const gameNumber = await fetchCurrentGame(
        publicClient,
        GAME_CONTRACT_ADDRESS,
      );
      setCurrentGameNumber(gameNumber);

      const state = await fetchDecodedGameStateDump(
        publicClient,
        GAME_CONTRACT_ADDRESS,
        gameNumber,
      );
      setGameState(state);
      setError(null);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch game state";
      setError(message);
      console.error("[useGameState] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchState();
    const interval = setInterval(() => void fetchState(), pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchState, pollIntervalMs]);

  return {
    gameState,
    currentGame: currentGameNumber,
    error,
    loading,
    refetch: () => void fetchState(),
  };
}
