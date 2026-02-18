import { useState, useMemo } from "react";
import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";
import { useWallet } from "../context/WalletContext";
import { useGameState } from "../hooks/useGameState";
import { DialogueBox } from "../components/DialogueBox";
import { SpriteLayer } from "../components/SpriteLayer";
import type { SpriteData } from "../components/SpriteLayer";
import { CountdownTimer } from "../components/CountdownTimer";
import { IngredientDot } from "../components/IngredientDot";
import { PlayerHistory } from "../components/PlayerHistory";
import { INGREDIENT_COLORS, INGREDIENTS } from "../constants/ingredients";
import type { Ingredient } from "../constants/ingredients";
import { buildPlayerEntries } from "../constants/players";
import type { PlayerEntry } from "../constants/players";

/** Phase labels indexed by the numeric phase value from the contract. */
const PHASE_LABELS: Record<number, string> = {
  0: "Lobby",
  1: "Commit",
  2: "Reveal",
  3: "Ended",
  4: "Cancelled",
};

/** Rat King dialogue lines indexed by phase. */
const PHASE_DIALOGUE: Record<number, string> = {
  0: "The kitchen is open! Waiting for more rats to join the game…",
  1: "Choose your ingredients wisely — the pizza won't make itself.",
  2: "Time to show what you've got, rat. Reveal your ingredients!",
  3: "The round is over. Let's see how the pizza turned out…",
  4: "The kitchen is closed. This game has been cancelled.",
};

/**
 * Game screen composed of three horizontal bands:
 *   1. Top section (flex) — left player list + right game viewport
 *   2. Bottom bar (60px) — navigation
 *
 * The right game viewport is further split vertically:
 *   - Status bar (70px) — round, pot, King's Recipe
 *   - Main viewport (flex) — oven background, sprites, dialogue, countdown
 *   - Contribution bar (60px) — ingredient dot picker + submit
 *
 * @returns The game screen UI.
 */
export function GameScreen(): JSX.Element {
  const { navigateTo } = useNavigation();
  const { address } = useWallet();
  const { gameState, loading, error } = useGameState({ pollIntervalMs: 1_000 });

  const players = useMemo(
    () => buildPlayerEntries(gameState, address),
    [gameState, address],
  );

  const currentRound = gameState?.currentRound ?? 0;
  const phase = gameState?.phase ?? 0;
  const phaseLabel = PHASE_LABELS[phase] ?? "Unknown";
  const dialogue = PHASE_DIALOGUE[phase] ?? PHASE_DIALOGUE[0];

  /**
   * Total score across all players, used as the "pot" display value.
   */
  const totalScore = useMemo((): number => {
    if (gameState === null) return 0;
    return gameState.playerStates.reduce(
      (sum, p) => sum + Number(p.score),
      0,
    );
  }, [gameState]);

  /**
   * Converts on-chain recipeWad (uint256[6] WAD values) into percentage
   * entries aligned with the INGREDIENTS array for the recipe bar.
   */
  const recipeEntries = useMemo((): { ingredient: Ingredient; percent: number }[] => {
    if (gameState === null) {
      return INGREDIENTS.map((ingredient) => ({
        ingredient,
        percent: 100 / INGREDIENTS.length,
      }));
    }
    const wads = gameState.recipeWad.map((v) => BigInt(v));
    const total = wads.reduce((sum, w) => sum + w, 0n);
    if (total === 0n) {
      return INGREDIENTS.map((ingredient) => ({
        ingredient,
        percent: 100 / INGREDIENTS.length,
      }));
    }
    return INGREDIENTS.map((ingredient, i) => ({
      ingredient,
      percent: Number((wads[i] * 10000n) / total) / 100,
    }));
  }, [gameState]);

  const [selectedIngredients, setSelectedIngredients] = useState<(Ingredient | null)[]>([
    null, null, null, null, null,
  ]);
  const [openDotIndex, setOpenDotIndex] = useState<number | null>(null);
  const [sprites] = useState<SpriteData[]>([]);

  /**
   * Returns the user to the main menu.
   */
  const handleBackToMenu = (): void => {
    navigateTo("mainMenu");
  };

  /**
   * Toggles which dot's dropdown is open. Closes if already open.
   * @param index - The dot index (0-4).
   */
  const handleDotToggle = (index: number): void => {
    setOpenDotIndex((prev) => (prev === index ? null : index));
  };

  /**
   * Updates the ingredient selection for a given dot index and closes the dropdown.
   * @param index - The dot index (0-4).
   * @param ingredient - The chosen ingredient.
   */
  const handleIngredientSelect = (index: number, ingredient: Ingredient): void => {
    setSelectedIngredients((prev) => {
      const next = [...prev];
      next[index] = ingredient;
      return next;
    });
    setOpenDotIndex(null);
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* ── Top section: player list (left) + game viewport (right) ── */}
      <div className="flex min-h-0 flex-1">

        {/* Player list: 320px wide, scrollable */}
        <div className="w-[320px] shrink-0 overflow-y-auto border-r border-[#d9ae78] bg-[#fff8ec]/80 px-1.5 py-4">
          <div className="flex flex-col gap-px">
            {players.map((player: PlayerEntry) => (
              <div
                key={player.id}
                className={`flex items-center gap-2 rounded-md border px-1.5 py-0.5 ${
                  player.isYou
                    ? "border-[#2f7a3f] bg-[#e6f5e9]"
                    : "border-[#edd2ac] bg-[#fff3df]"
                }`}
              >
                <img
                  src={player.portrait}
                  alt={`${player.name} portrait`}
                  className="h-10 w-10 shrink-0 rounded-lg border-2 border-[#d9ae78] object-cover"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-bold text-[#3f2a14]">{player.name}</p>
                  <p className="truncate text-xs text-[#6f4d29]">Score: {player.score}</p>
                </div>
                <div className="shrink-0">
                  <PlayerHistory />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Game viewport column */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#fff3df]/50">

          {/* Status bar: 70px — round, phase, pot, King's Recipe */}
          <div className="flex h-[70px] shrink-0 items-end gap-8 border-b border-[#d9ae78] bg-[#fff8ec]/80 px-6 pb-3">
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a5d20]">Round</p>
              <p className="text-lg font-black leading-none text-[#3f2a14]">{currentRound}</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a5d20]">Phase</p>
              <p className="text-lg font-black leading-none text-[#3f2a14]">{phaseLabel}</p>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a5d20]">Total Score</p>
              <p className="text-lg font-black leading-none text-[#3f2a14]">{totalScore.toLocaleString()}</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9a5d20]">King's Recipe</p>
              <div className="flex h-4 w-full overflow-hidden rounded-full">
                {recipeEntries.map((entry) => (
                  <div
                    key={entry.ingredient}
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${entry.percent}%`,
                      backgroundColor: INGREDIENT_COLORS[entry.ingredient],
                    }}
                    title={`${entry.ingredient}: ${entry.percent.toFixed(1)}%`}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Main viewport: oven background, sprites, dialogue, timer */}
          <div
            className="relative flex min-h-0 flex-1 flex-col bg-cover bg-center bg-no-repeat p-4"
            style={{ backgroundImage: "url('/oven.png')" }}
          >
            <SpriteLayer sprites={sprites} />
            <CountdownTimer />
            <div className="flex-1" />
            <div className="relative z-10">
              {error !== null ? (
                <DialogueBox
                  name="Rat King"
                  portrait="/king-neutral.png"
                  body={`Something went wrong in the kitchen… ${error}`}
                />
              ) : loading ? (
                <DialogueBox
                  name="Rat King"
                  portrait="/king-neutral.png"
                  body="Connecting to the kitchen…"
                />
              ) : (
                <DialogueBox
                  name="Rat King"
                  portrait="/king-neutral.png"
                  body={dialogue}
                />
              )}
            </div>
          </div>

          {/* Contribution bar: 60px — ingredient picker + submit */}
          <div className="flex h-[60px] shrink-0 items-center gap-3 border-t border-[#d9ae78] bg-[#fff8ec]/80 px-3">
            <p className="shrink-0 text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">
              Contribution
            </p>
            <div className="flex items-center gap-4">
              {selectedIngredients.map((ingredient, i) => (
                <IngredientDot
                  key={i}
                  index={i}
                  selected={ingredient}
                  isOpen={openDotIndex === i}
                  onToggle={handleDotToggle}
                  onSelect={handleIngredientSelect}
                />
              ))}
              <button
                type="button"
                disabled={address === null}
                className={`ml-4 rounded-xl px-6 py-3 text-sm font-bold shadow transition ${
                  address === null
                    ? "cursor-not-allowed bg-[#b0a898] text-[#e0dcd6]"
                    : "bg-[#2f7a3f] text-[#f6fff8] hover:bg-[#275f33] active:scale-95"
                }`}
              >
                {address === null ? "Spectating" : "Submit"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom bar: 60px — navigation ── */}
      <div className="flex h-[60px] shrink-0 items-center justify-between border-t border-[#d9ae78] bg-[#fff8ec]/90 px-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">
          Bottom Panel
        </p>
        <button
          type="button"
          onClick={handleBackToMenu}
          className="rounded-xl border border-[#d9ae78] bg-[#fff8ec] px-4 py-2 text-sm font-semibold text-[#7c4a1e] transition hover:bg-[#f4e3cf]"
        >
          ← Menu
        </button>
      </div>
    </div>
  );
}
