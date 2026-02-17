import { useState } from "react";
import type { JSX } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";

/**
 * Converts unknown thrown values into a safe UI message.
 * @param error - The unknown thrown value.
 * @returns A user-facing error message.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected wallet error. Please retry.";
}

/**
 * Shortens a full wallet address for compact display.
 * @param address - The full wallet address.
 * @returns A shortened display version of the address.
 */
function shortenAddress(address: string): string {
  if (address.length < 10) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Renders the Privy-authenticated wallet landing page.
 * @returns The Pizza Rat wallet view.
 */
export default function App(): JSX.Element {
  const { ready, authenticated, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const [actionError, setActionError] = useState<string | null>(null);

  const primaryWalletAddress: string | null = wallets[0]?.address ?? null;

  /**
   * Starts Privy login with explicit async error handling.
   * @returns A promise that resolves once login has been requested.
   * @throws Never. Errors are captured in component state.
   */
  const handleLoginClick = async (): Promise<void> => {
    try {
      setActionError(null);
      await login();
    } catch (error: unknown) {
      setActionError(toErrorMessage(error));
    }
  };

  /**
   * Starts Privy logout with explicit async error handling.
   * @returns A promise that resolves once logout has been requested.
   * @throws Never. Errors are captured in component state.
   */
  const handleLogoutClick = async (): Promise<void> => {
    try {
      setActionError(null);
      await logout();
    } catch (error: unknown) {
      setActionError(toErrorMessage(error));
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff6e4_0%,#f8e1be_35%,#f7d0aa_100%)] px-4 py-10 text-[#2f2317]">
      <section className="mx-auto flex w-full max-w-xl flex-col gap-6 rounded-3xl border border-[#d9ae78] bg-[#fff8ec]/90 p-8 shadow-[0_16px_60px_-24px_rgba(72,43,16,0.45)] backdrop-blur">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9a5d20]">
            Monad Testnet
          </p>
          <h1 className="text-3xl font-black leading-tight text-[#3f2a14]">
            Pizza Rat Lobby
          </h1>
          <p className="text-sm text-[#6f4d29]">
            Connect your wallet with Privy before joining the match.
          </p>
        </header>

        <div className="rounded-2xl border border-[#edd2ac] bg-[#fff3df] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8c5a2b]">
            Wallet status
          </p>
          {!ready && (
            <p className="mt-2 text-sm text-[#8f6437]">Privy is initializing...</p>
          )}
          {ready && !authenticated && (
            <p className="mt-2 text-sm text-[#8f6437]">No wallet connected.</p>
          )}
          {ready && authenticated && (
            <div className="mt-2 space-y-1 text-sm text-[#5b3b19]">
              <p>Connected</p>
              <p className="font-mono text-[0.82rem]">
                {primaryWalletAddress === null
                  ? "Waiting for wallet address..."
                  : shortenAddress(primaryWalletAddress)}
              </p>
              <p>Linked wallets: {wallets.length}</p>
            </div>
          )}
        </div>

        {actionError !== null && (
          <p className="rounded-xl border border-[#c93f20] bg-[#fff2ef] px-4 py-3 text-sm text-[#8b1b00]">
            {actionError}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleLoginClick}
            disabled={!ready || authenticated}
            className="rounded-xl bg-[#d6452e] px-5 py-2.5 text-sm font-semibold text-[#fffaf2] transition hover:bg-[#bc3a26] disabled:cursor-not-allowed disabled:bg-[#d79f94]"
          >
            Connect wallet
          </button>
          <button
            type="button"
            onClick={handleLogoutClick}
            disabled={!ready || !authenticated}
            className="rounded-xl border border-[#ba8a54] bg-[#fff8ef] px-5 py-2.5 text-sm font-semibold text-[#7c4a1e] transition hover:bg-[#f4e3cf] disabled:cursor-not-allowed disabled:border-[#d4bc9c] disabled:text-[#b39a7e]"
          >
            Disconnect
          </button>
        </div>
      </section>
    </main>
  );
}
