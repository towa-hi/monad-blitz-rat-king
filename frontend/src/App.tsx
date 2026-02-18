import type { JSX } from "react";
import { NavigationProvider, useNavigation } from "./context/NavigationContext";
import type { Screen } from "./context/NavigationContext";
import { WalletProvider } from "./context/WalletContext";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { MainMenuScreen } from "./screens/MainMenuScreen";
import { GameScreen } from "./screens/GameScreen";

/**
 * Maps a screen identifier to the corresponding React component.
 * @param screen - The screen to render.
 * @returns The JSX element for the given screen.
 */
function renderScreen(screen: Screen): JSX.Element {
  switch (screen) {
    case "onboarding":
      return <OnboardingScreen />;
    case "login":
      return <LoginScreen />;
    case "mainMenu":
      return <MainMenuScreen />;
    case "game":
      return <GameScreen />;
  }
}

/**
 * Inner component that reads navigation state and renders the active screen.
 * Separated from App so that useNavigation is called within the provider.
 * @returns The currently active screen.
 */
function ScreenRouter(): JSX.Element {
  const { currentScreen } = useNavigation();

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff6e4_0%,#f8e1be_35%,#f7d0aa_100%)] text-[#2f2317]">
      {renderScreen(currentScreen)}
    </main>
  );
}

/**
 * Root application component that provides navigation context
 * and renders the screen router.
 * @returns The full application wrapped in providers.
 */
export default function App(): JSX.Element {
  return (
    <WalletProvider>
      <NavigationProvider>
        <ScreenRouter />
      </NavigationProvider>
    </WalletProvider>
  );
}
