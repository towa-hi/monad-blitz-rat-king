import { useState } from "react";
import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";
import { DialogueBox } from "../components/DialogueBox";

/** The six available ingredients. */
const INGREDIENTS = ["Dough", "Sauce", "Cheese", "Pepperoni", "Basil", "Anchovy"] as const;

/** A single ingredient name. */
type Ingredient = (typeof INGREDIENTS)[number];

/** Color mapping for each ingredient dot. */
const INGREDIENT_COLORS: Record<Ingredient, string> = {
  Dough: "#d4a867",
  Sauce: "#c0392b",
  Cheese: "#f5c542",
  Pepperoni: "#d6452e",
  Basil: "#2e7d32",
  Anchovy: "#6b8fa3",
};

/** Props for a single selectable ingredient dot. */
interface IngredientDotProps {
  /** Index of this dot (0-4). */
  readonly index: number;
  /** Currently selected ingredient, if any. */
  readonly selected: Ingredient | null;
  /** Whether this dot's dropdown is currently open. */
  readonly isOpen: boolean;
  /** Callback when this dot is clicked to toggle its dropdown. */
  readonly onToggle: (index: number) => void;
  /** Callback when an ingredient is chosen. */
  readonly onSelect: (index: number, ingredient: Ingredient) => void;
}

/**
 * A large clickable dot that opens a dropdown to pick an ingredient.
 * @param props - Dot index, current selection, open state, and handlers.
 * @returns A clickable dot with an ingredient picker dropdown.
 */
function IngredientDot(props: IngredientDotProps): JSX.Element {
  /**
   * Toggles this dot's dropdown.
   */
  const handleClick = (): void => {
    props.onToggle(props.index);
  };

  /**
   * Selects an ingredient and closes the dropdown.
   * @param ingredient - The chosen ingredient.
   */
  const handleSelect = (ingredient: Ingredient): void => {
    props.onSelect(props.index, ingredient);
  };

  const dotColor = props.selected !== null
    ? INGREDIENT_COLORS[props.selected]
    : "#3f2a14";
  const dotOpacity = props.selected !== null ? "1" : "0.3";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleClick}
        className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#d9ae78] transition hover:scale-110 active:scale-95"
        style={{ backgroundColor: dotColor, opacity: dotOpacity }}
        title={props.selected ?? "Select ingredient"}
      >
        {props.selected !== null && (
          <span className="text-xs font-bold text-white drop-shadow">
            {props.selected.charAt(0)}
          </span>
        )}
      </button>
      {props.isOpen && (
        <div className="absolute bottom-full left-1/2 z-20 mb-1 -translate-x-1/2 rounded-lg border border-[#d9ae78] bg-[#fff8ec] py-1 shadow-lg">
          {INGREDIENTS.map((ingredient) => (
            <button
              key={ingredient}
              type="button"
              onClick={(): void => handleSelect(ingredient)}
              className="flex w-full items-center gap-1.5 whitespace-nowrap px-2 py-0.5 text-left text-sm text-[#3f2a14] transition hover:bg-[#f4e3cf]"
            >
              <span
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: INGREDIENT_COLORS[ingredient] }}
              />
              {ingredient}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Props for a single round history column. */
interface RoundHistoryIngredientsProps {
  /** The round number to display in the tooltip. */
  readonly round: number;
  /** Dummy contribution value for the tooltip. */
  readonly contribution: number;
  /** Dummy uniqueness value for the tooltip. */
  readonly uniqueness: number;
}

/**
 * A single column of five dots representing ingredient outcomes for one round.
 * Shows a tooltip on hover with round, contribution, and uniqueness.
 * @param props - Round data for the tooltip.
 * @returns Five vertically stacked dots with a hover tooltip.
 */
function RoundHistoryIngredients(props: RoundHistoryIngredientsProps): JSX.Element {
  const tooltipText = `Round ${props.round}\nContribution: ${props.contribution}\nUniqueness: ${props.uniqueness}`;

  return (
    <div
      className="flex flex-col items-center gap-0.5 cursor-default"
      title={tooltipText}
    >
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[#3f2a14]/40"
        />
      ))}
    </div>
  );
}

/**
 * Horizontal list of RoundHistoryIngredients columns showing round history.
 * @returns The history component.
 */
function History(): JSX.Element {
  return (
    <div className="flex h-full items-center gap-1 overflow-x-auto">
      {Array.from({ length: 6 }, (_, i) => (
        <RoundHistoryIngredients
          key={i}
          round={i + 1}
          contribution={Math.floor(Math.random() * 100)}
          uniqueness={Math.floor(Math.random() * 50)}
        />
      ))}
    </div>
  );
}

/** Dummy recipe distribution for the King's Recipe stacked bar. */
const KINGS_RECIPE: { ingredient: Ingredient; percent: number }[] = [
  { ingredient: "Dough", percent: 25 },
  { ingredient: "Sauce", percent: 20 },
  { ingredient: "Cheese", percent: 20 },
  { ingredient: "Pepperoni", percent: 15 },
  { ingredient: "Basil", percent: 10 },
  { ingredient: "Anchovy", percent: 10 },
];

/**
 * A wide 100% stacked bar chart showing the King's Recipe ingredient distribution.
 * @returns The stacked bar chart UI.
 */
function KingsRecipe(): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">
        King's Recipe
      </p>
      <div className="flex h-5 w-full overflow-hidden rounded-full">
        {KINGS_RECIPE.map((entry) => (
          <div
            key={entry.ingredient}
            className="h-full"
            style={{
              width: `${entry.percent}%`,
              backgroundColor: INGREDIENT_COLORS[entry.ingredient],
            }}
            title={`${entry.ingredient}: ${entry.percent}%`}
          />
        ))}
      </div>
    </div>
  );
}

/** A single player entry in the left panel list. */
interface PlayerEntry {
  /** Unique identifier. */
  readonly id: number;
  /** Display name. */
  readonly name: string;
  /** Current score. */
  readonly score: number;
  /** Whether this entry is the local player. */
  readonly isYou: boolean;
}

/** Index of the local player in the list. */
const LOCAL_PLAYER_INDEX = 2;

/** Twenty dummy player entries for the scrollable left panel. */
const PLAYER_ENTRIES: PlayerEntry[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  name: i === LOCAL_PLAYER_INDEX ? `Rat #${i + 1} (You)` : `Rat #${i + 1}`,
  score: Math.floor(1000 - i * 42),
  isYou: i === LOCAL_PLAYER_INDEX,
}));

/**
 * Game screen split into a top section and a fixed-height bottom panel.
 * The top section is further split into a fixed-width left panel and a flexible right panel.
 * @returns The game screen UI.
 */
export function GameScreen(): JSX.Element {
  const { navigateTo } = useNavigation();
  const [selectedIngredients, setSelectedIngredients] = useState<(Ingredient | null)[]>([
    null, null, null, null, null,
  ]);
  const [openDotIndex, setOpenDotIndex] = useState<number | null>(null);

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
      {/* Top section: fills remaining space */}
      <div className="flex min-h-0 flex-1">
        {/* Top-left panel: fixed 400px width, scrollable player list */}
        <div className="w-[320px] shrink-0 overflow-y-auto border-r border-[#d9ae78] bg-[#fff8ec]/80 px-1.5 py-4">
          <div className="flex flex-col gap-px">
            {PLAYER_ENTRIES.map((player) => (
              <div
                key={player.id}
                className={`flex items-center gap-2 rounded-md border px-1.5 py-0.5 ${
                  player.isYou
                    ? "border-[#2f7a3f] bg-[#e6f5e9]"
                    : "border-[#edd2ac] bg-[#fff3df]"
                }`}
              >
                {/* Portrait */}
                <img
                  src="/vite.svg"
                  alt={`${player.name} portrait`}
                  className="h-7 w-7 shrink-0 rounded-full border border-[#d9ae78] bg-[#fff8ec] object-cover p-0.5"
                />
                {/* Info panel: fills remaining space */}
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="truncate text-sm font-bold text-[#3f2a14]">{player.name}</p>
                  <p className="truncate text-xs text-[#6f4d29]">Score: {player.score}</p>
                </div>
                {/* History: right-aligned */}
                <div className="shrink-0">
                  <History />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top-right panel: fills remaining width */}
        <div className="flex min-w-0 flex-1 flex-col bg-[#fff3df]/50">
          {/* Round info panel: fixed 100px */}
          <div className="flex h-[100px] shrink-0 items-center gap-8 border-b border-[#d9ae78] bg-[#fff8ec]/80 px-6">
            <div className="flex flex-col">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">Round</p>
              <p className="text-2xl font-black text-[#3f2a14]">3</p>
            </div>
            <div className="flex flex-col">
              <p className="text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">Current Pot</p>
              <p className="text-2xl font-black text-[#3f2a14]">1,250</p>
            </div>
            <div className="min-w-0 flex-1">
              <KingsRecipe />
            </div>
          </div>
          {/* Right panel main area */}
          <div className="flex min-h-0 flex-1 flex-col bg-purple-300 p-4">
            <div className="flex-1" />
            {/* RPG dialogue box */}
            <DialogueBox
              name="Rat King"
              portrait="/vite.svg"
              body="Welcome to the kitchen, rat. Choose your ingredients wisely — the pizza won't make itself."
            />
          </div>
          {/* Input panel: fixed 100px tall */}
          <div className="flex h-[60px] shrink-0 items-center gap-3 border-t border-[#d9ae78] bg-[#fff8ec]/80 px-3">
            <p className="shrink-0 text-xs font-semibold uppercase tracking-widest text-[#9a5d20]">
              Contribution
            </p>
            <div className="flex items-center gap-4">
              {/* Five ingredient dots */}
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
              {/* Submit button */}
              <button
                type="button"
                className="ml-4 rounded-xl bg-[#2f7a3f] px-6 py-3 text-sm font-bold text-[#f6fff8] shadow transition hover:bg-[#275f33] active:scale-95"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom panel: fixed 500px height */}
      <div className="h-[60px] shrink-0 border-t border-[#d9ae78] bg-[#fff8ec]/90 p-4">
        <div className="flex items-center justify-between">
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
    </div>
  );
}
