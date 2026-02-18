import { useMemo } from "react";
import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";
import { useWallet } from "../context/WalletContext";
import { useGameState } from "../hooks/useGameState.ts";
import { buildPlayerEntries } from "../constants/players";
import type { PlayerEntry } from "../constants/players";

/**
 * Props for a single player card in the lobby grid.
 */
interface PlayerCardProps {
  /** The player entry data. */
  readonly player: PlayerEntry;
  /** Whether this slot is empty (no player has joined). */
  readonly empty: boolean;
}

/**
 * A single player card displayed within the lobby grid.
 * Shows portrait, name, score, and a "you" indicator for the local player.
 * Renders in a grayed-out state when the slot is unoccupied.
 *
 * @param props - The player entry data and occupancy flag.
 * @returns A styled player card element.
 */
function PlayerCard(props: PlayerCardProps): JSX.Element {
  const { player, empty } = props;

  if (empty) {
    return (
      <div className="flex flex-1 items-center gap-1.5 rounded-lg border border-[#e0d6c8] bg-[#f0ece4]/60 px-1.5 opacity-50">
        <div className="h-6 w-6 shrink-0 rounded-md border border-[#d4cfc6] bg-[#ddd8cf]" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-sm leading-none font-bold text-[#b0a898]">
            Empty
          </p>
          <p className="truncate text-xs leading-none text-[#c0b8aa]">
            Waiting…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-1 items-center gap-1.5 rounded-lg border px-1.5 transition-all duration-150 ${
        player.isYou
          ? "border-[#2f7a3f] bg-[#e6f5e9]"
          : "border-[#edd2ac] bg-[#fff3df]/80 hover:bg-[#fff8ec]"
      }`}
    >
      <img
        src={player.portrait}
        alt={`${player.name} portrait`}
        className="h-6 w-6 shrink-0 rounded-md border border-[#d9ae78] object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-sm leading-none font-bold text-[#3f2a14]">
          {player.name}
        </p>
        <p className="truncate text-xs leading-none text-[#6f4d29]">
          Score: {player.score}
        </p>
      </div>
      {player.isYou && (
        <span className="shrink-0 rounded-md bg-[#2f7a3f] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          You
        </span>
      )}
    </div>
  );
}

/**
 * Main menu screen with a lobby panel showing the current game state
 * as a 4x5 grid of player entries.
 * @returns The main menu screen UI.
 */
/** Phase labels indexed by the numeric phase value from the contract. */
const PHASE_LABELS: Record<number, string> = {
  0: "Waiting for players",
  1: "Commit phase",
  2: "Reveal phase",
  3: "Resolution",
  4: "Game over",
};

export function MainMenuScreen(): JSX.Element {
  const { navigateTo } = useNavigation();
  const { address } = useWallet();
  const { gameState, loading, error } = useGameState({ pollIntervalMs: 1_000 });

  const players = useMemo(
    () => buildPlayerEntries(gameState, address),
    [gameState, address],
  );

  /**
   * Navigates the user into the game screen.
   */
  const handleStartGame = (): void => {
    navigateTo("game");
  };

  const playerCount = gameState?.playerCount ?? 0;
  const currentRound = gameState?.currentRound ?? 0;
  const phase = gameState?.phase ?? 0;
  const phaseLabel = PHASE_LABELS[phase] ?? "Unknown";
  const gameInProgress = phase >= 1 && phase <= 3;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-4">
      {/* Header */}
      <div className="animate-fade-in text-center">
        <h1 className="text-2xl font-black text-[#3f2a14]">Main Menu</h1>
      </div>

      {/* Connection status */}
      {error !== null && (
        <p className="text-xs font-semibold text-red-600">
          Failed to fetch game state: {error}
        </p>
      )}

      {/* Game state lobby panel */}
      <div className="animate-fade-in w-full max-w-screen-2xl">
        <div className="overflow-hidden rounded-2xl border-2 border-[#d9ae78] bg-[#fff8ec]/90 shadow-[0_8px_32px_rgba(72,43,16,0.12)]">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-[#d9ae78] px-4 py-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">
              Lobby — {playerCount} Players — Round: {currentRound}/5
            </p>
            <div className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${loading ? "animate-pulse bg-[#9a5d20]" : "animate-pulse bg-[#2f7a3f]"}`} />
              <p className={`text-xs font-semibold ${loading ? "text-[#9a5d20]" : "text-[#2f7a3f]"}`}>
                {loading ? "Connecting…" : phaseLabel}
              </p>
            </div>
          </div>

          {/* 4x5 player grid */}
          <div className="grid grid-cols-4 grid-rows-5 gap-1 px-1.5 py-1">
            {players.map((player) => (
              <PlayerCard key={player.id} player={player} empty={!player.occupied} />
            ))}
          </div>
        </div>
      </div>

      {/* Start game button */}
      <div className="animate-fade-in">
        <button
          type="button"
          onClick={handleStartGame}
          className="rounded-2xl bg-[#2f7a3f] px-10 py-3 text-lg font-bold text-[#f6fff8] shadow-[0_4px_24px_rgba(47,122,63,0.4)] transition-all duration-200 hover:scale-[1.03] hover:bg-[#275f33] active:scale-[0.98]"
        >
          {gameInProgress ? "Start Game" : "Join Game"}
        </button>
      </div>
    </div>
  );
}
