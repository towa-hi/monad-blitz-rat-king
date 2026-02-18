import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";
import { PLAYER_ENTRIES } from "../constants/players";
import type { PlayerEntry } from "../constants/players";

/**
 * A single player card displayed within the lobby grid.
 * Shows portrait, name, score, and a "you" indicator for the local player.
 * @param props - The player entry data.
 * @returns A styled player card element.
 */
function PlayerCard(props: { readonly player: PlayerEntry }): JSX.Element {
  const { player } = props;

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
export function MainMenuScreen(): JSX.Element {
  const { navigateTo } = useNavigation();

  /**
   * Navigates the user into the game screen.
   */
  const handleStartGame = (): void => {
    navigateTo("game");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-4">
      {/* Header */}
      <div className="animate-fade-in text-center">
        <h1 className="text-2xl font-black text-[#3f2a14]">Main Menu</h1>
      </div>

      {/* Game state lobby panel */}
      <div className="animate-fade-in w-full max-w-screen-2xl">
        <div className="overflow-hidden rounded-2xl border-2 border-[#d9ae78] bg-[#fff8ec]/90 shadow-[0_8px_32px_rgba(72,43,16,0.12)]">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-[#d9ae78] px-4 py-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">
              Lobby — {PLAYER_ENTRIES.length} Players — Round: 0/5
            </p>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#2f7a3f]" />
              <p className="text-xs font-semibold text-[#2f7a3f]">
                Waiting for players
              </p>
            </div>
          </div>

          {/* 4x5 player grid */}
          <div className="grid grid-cols-4 grid-rows-5 gap-1 px-1.5 py-1">
            {PLAYER_ENTRIES.map((player) => (
              <PlayerCard key={player.id} player={player} />
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
          Start Game
        </button>
      </div>
    </div>
  );
}
