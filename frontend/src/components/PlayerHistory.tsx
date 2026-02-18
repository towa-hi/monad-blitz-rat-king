import type { JSX } from "react";

/** Number of rounds shown per player history. */
const ROUND_COUNT = 6;

/** Number of ingredients per round. */
const INGREDIENTS_PER_ROUND = 5;

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
      className="flex cursor-default flex-col items-center gap-0.5"
      title={tooltipText}
    >
      {Array.from({ length: INGREDIENTS_PER_ROUND }, (_, i) => (
        <div
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[#3f2a14]/40"
        />
      ))}
    </div>
  );
}

/**
 * Horizontal list of RoundHistoryIngredients columns showing a player's round history.
 * @returns The history component.
 */
export function PlayerHistory(): JSX.Element {
  return (
    <div className="flex h-full items-center gap-1 overflow-x-auto">
      {Array.from({ length: ROUND_COUNT }, (_, i) => (
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
