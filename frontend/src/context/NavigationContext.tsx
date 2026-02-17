import { createContext, useContext, useState, useCallback } from "react";
import type { JSX, ReactNode } from "react";

/** All navigable screens in the application. */
export type Screen = "onboarding" | "login" | "mainMenu" | "game";

/** Shape of the navigation context value. */
interface NavigationContextValue {
  /** The currently active screen. */
  readonly currentScreen: Screen;
  /** The previously active screen, used for transition direction. */
  readonly previousScreen: Screen | null;
  /** Navigate to a target screen. */
  readonly navigateTo: (screen: Screen) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

/** Props for the NavigationProvider wrapper. */
interface NavigationProviderProps {
  /** Child components to render within the provider. */
  readonly children: ReactNode;
}

/**
 * Provides screen navigation state to the component tree.
 * @param props - Provider props containing children.
 * @returns Navigation context provider wrapping children.
 */
export function NavigationProvider(props: NavigationProviderProps): JSX.Element {
  const [currentScreen, setCurrentScreen] = useState<Screen>("onboarding");
  const [previousScreen, setPreviousScreen] = useState<Screen | null>(null);

  const navigateTo = useCallback(
    (screen: Screen): void => {
      setPreviousScreen(currentScreen);
      setCurrentScreen(screen);
    },
    [currentScreen],
  );

  return (
    <NavigationContext.Provider
      value={{ currentScreen, previousScreen, navigateTo }}
    >
      {props.children}
    </NavigationContext.Provider>
  );
}

/**
 * Hook to access the navigation context from any child component.
 * @returns The current navigation context value.
 * @throws If called outside of a NavigationProvider.
 */
export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (context === null) {
    throw new Error("useNavigation must be used within a NavigationProvider.");
  }

  return context;
}
