import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";

/**
 * Onboarding screen with a single log-in entry point.
 * @returns The onboarding screen UI.
 */
export function OnboardingScreen(): JSX.Element {
  const { navigateTo } = useNavigation();

  /**
   * Navigates the user to the login screen.
   */
  const handleLogIn = (): void => {
    navigateTo("login");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="animate-fade-in flex flex-col items-center gap-8 text-center">
        <span className="text-7xl" role="img" aria-label="Rat">🐀</span>
        <h1 className="text-4xl font-black text-[#3f2a14]">Pizza Rat</h1>
        <button
          type="button"
          onClick={handleLogIn}
          className="rounded-2xl bg-[#d6452e] px-10 py-4 text-lg font-bold text-[#fffaf2] shadow-[0_4px_24px_rgba(214,69,46,0.4)] transition-all duration-200 hover:scale-[1.03] hover:bg-[#bc3a26] active:scale-[0.98]"
        >
          Log In
        </button>
      </div>
    </div>
  );
}
