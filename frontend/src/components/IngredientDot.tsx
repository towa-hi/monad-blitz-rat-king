import type { JSX } from "react";
import { INGREDIENTS, INGREDIENT_COLORS } from "../constants/ingredients";
import type { Ingredient } from "../constants/ingredients";

/** Props for a single selectable ingredient dot. */
export interface IngredientDotProps {
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
export function IngredientDot(props: IngredientDotProps): JSX.Element {
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
