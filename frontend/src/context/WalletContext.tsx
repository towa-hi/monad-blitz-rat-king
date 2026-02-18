import { createContext, useContext, useState, useCallback } from "react";
import type { JSX, ReactNode } from "react";
import type { Address } from "viem";

/** Shape of the wallet context value. */
interface WalletContextValue {
  /** The connected wallet address, or null if not connected. */
  readonly address: Address | null;
  /** Set the connected wallet address. */
  readonly setAddress: (address: Address | null) => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

/** Props for the WalletProvider wrapper. */
interface WalletProviderProps {
  /** Child components to render within the provider. */
  readonly children: ReactNode;
}

/**
 * Provides connected wallet state to the component tree.
 * Stores the current user's wallet address so downstream components
 * can determine which on-chain player is the local user.
 *
 * @param props - Provider props containing children.
 * @returns Wallet context provider wrapping children.
 */
export function WalletProvider(props: WalletProviderProps): JSX.Element {
  const [address, setAddressState] = useState<Address | null>(null);

  const setAddress = useCallback((addr: Address | null): void => {
    setAddressState(addr);
  }, []);

  return (
    <WalletContext.Provider value={{ address, setAddress }}>
      {props.children}
    </WalletContext.Provider>
  );
}

/**
 * Hook to access the wallet context from any child component.
 *
 * @returns The current wallet context value.
 * @throws If called outside of a WalletProvider.
 */
export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (context === null) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }

  return context;
}
