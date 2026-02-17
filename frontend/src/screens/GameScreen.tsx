import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";

/**
 * Empty game screen placeholder.
 * @returns The game screen UI.
 */
export function GameScreen(): JSX.Element {
  const { navigateTo } = useNavigation();

  /**
   * Returns the user to the main menu.
   */
  const handleBackToMenu = (): void => {
    navigateTo("mainMenu");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="animate-fade-in flex flex-col items-center gap-6 text-center">
        <h1 className="text-3xl font-black text-[#3f2a14]">Game</h1>
        <button
          type="button"
          onClick={handleBackToMenu}
          className="rounded-xl border border-[#d9ae78] bg-[#fff8ec] px-6 py-3 text-sm font-semibold text-[#7c4a1e] transition hover:bg-[#f4e3cf]"
        >
          ← Back to Menu
        </button>
      </div>
    </div>
  );
}
