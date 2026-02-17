import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";

/**
 * Main menu screen with a start game button.
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
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="animate-fade-in flex flex-col items-center gap-8 text-center">
        <span className="text-5xl" role="img" aria-label="Rat">🐀</span>
        <h1 className="text-3xl font-black text-[#3f2a14]">Main Menu</h1>
        <button
          type="button"
          onClick={handleStartGame}
          className="rounded-2xl bg-[#2f7a3f] px-10 py-4 text-lg font-bold text-[#f6fff8] shadow-[0_4px_24px_rgba(47,122,63,0.4)] transition-all duration-200 hover:scale-[1.03] hover:bg-[#275f33] active:scale-[0.98]"
        >
          Start Game
        </button>
      </div>
    </div>
  );
}
