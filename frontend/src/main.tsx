import { StrictMode } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";

import App from "./App";
import "./style.css";

/**
 * Renders setup guidance when the Privy app id is not configured.
 * @returns A configuration guidance view.
 */
function MissingPrivyConfig(): JSX.Element {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff6e4_0%,#f8e1be_35%,#f7d0aa_100%)] px-4 py-10 text-[#2f2317]">
      <section className="mx-auto w-full max-w-xl rounded-3xl border border-[#d9ae78] bg-[#fff8ec]/90 p-8 shadow-[0_16px_60px_-24px_rgba(72,43,16,0.45)]">
        <h1 className="text-2xl font-black text-[#3f2a14]">
          Missing Privy App ID
        </h1>
        <p className="mt-3 text-sm text-[#6f4d29]">
          Set <code>VITE_PRIVY_APP_ID</code> in{" "}
          <code>/Users/user/vcs/int/monad-blitz-rat-king/frontend/.env</code>{" "}
          and restart the dev server.
        </p>
      </section>
    </main>
  );
}

const appRootElement: HTMLElement | null = document.getElementById("app");

if (appRootElement === null) {
  throw new Error("App root element '#app' was not found.");
}

const privyAppId: string | undefined = import.meta.env.VITE_PRIVY_APP_ID;
const hasPrivyAppId: boolean =
  typeof privyAppId === "string" && privyAppId.length > 0;

createRoot(appRootElement).render(
  <StrictMode>
    {hasPrivyAppId && privyAppId !== undefined ? (
      <PrivyProvider
        appId={privyAppId}
        config={{
          embeddedWallets: {
            createOnLogin: "users-without-wallets",
            showWalletUIs: false,
          },
        }}
      >
        <App />
      </PrivyProvider>
    ) : (
      <MissingPrivyConfig />
    )}
  </StrictMode>,
);
