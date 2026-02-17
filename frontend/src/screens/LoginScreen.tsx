import type { JSX } from "react";
import { useNavigation } from "../context/NavigationContext";

/**
 * Dummy login screen with a placeholder wallet connect button.
 * @returns The login screen UI.
 */
export function LoginScreen(): JSX.Element {
  const { navigateTo } = useNavigation();

  /**
   * Simulates a wallet connection and proceeds to the main menu.
   */
  const handleConnectWallet = (): void => {
    navigateTo("mainMenu");
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="animate-fade-in flex flex-col items-center gap-6 text-center">
        <span className="text-5xl" role="img" aria-label="Key">🔑</span>
        <h2 className="text-2xl font-black text-[#3f2a14]">Connect Wallet</h2>
        <button
          type="button"
          onClick={handleConnectWallet}
          className="rounded-2xl bg-[#d6452e] px-10 py-4 text-lg font-bold text-[#fffaf2] shadow-[0_4px_24px_rgba(214,69,46,0.4)] transition-all duration-200 hover:scale-[1.03] hover:bg-[#bc3a26] active:scale-[0.98]"
        >
          Connect Wallet
        </button>
      </div>
    </div>
  );
}
