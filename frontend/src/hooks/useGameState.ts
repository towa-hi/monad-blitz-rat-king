import { useCallback, useEffect, useState } from "react";
import { createPublicClient, http } from "viem";
import { monad } from "viem/chains";
import { fetchDecodedGameStateDump } from "@shared/gameStateDump.ts";
import type { GameStateJson } from "@shared/gameStateDump.ts";
import { GAME_CONTRACT_ADDRESS } from "../config.ts";

export type { GameStateJson };

/** Default polling interval for refreshing game state (ms). */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

const publicClient = createPublicClient({
  chain: monad,
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
  /** Error message if the last fetch failed. */
  error: string | null;
  /** Whether an initial load is in progress. */
  loading: boolean;
  /** Manually trigger a refetch. */
  refetch: () => void;
}

/**
 * React hook that polls the on-chain game state dump for a given game number.
 * Automatically refreshes at the configured polling interval.
 *
 * @param gameNumber - The game number to fetch state for.
 * @param options - Optional configuration (polling interval, etc.).
 * @returns The current game state, loading flag, error, and a manual refetch function.
 */
export function useGameState(
  gameNumber: number,
  options?: UseGameStateOptions,
): UseGameStateResult {
  const pollIntervalMs = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const [gameState, setGameState] = useState<GameStateJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const fetchState = useCallback(async (): Promise<void> => {
    try {
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
  }, [gameNumber]);

  useEffect(() => {
    void fetchState();
    const interval = setInterval(() => void fetchState(), pollIntervalMs);
    return () => clearInterval(interval);
  }, [fetchState, pollIntervalMs]);

  return { gameState, error, loading, refetch: () => void fetchState() };
}
