import { useMemo, useState } from "react";
import type { JSX } from "react";
import {
  usePrivy,
  useSendTransaction,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";

type HexString = `0x${string}`;

interface RegisterRequestBody {
  walletAddress: string;
}

interface CommitRequestBody {
  commitment: string;
}

interface RevealRequestBody {
  move: number;
  salt: string;
}

interface RegisterResponseData {
  userId: string;
  walletAddress: string;
  walletId: string;
  updatedAtMs: number;
}

interface RelayActionResponseData {
  action: "leave" | "commit" | "reveal";
  txHash: HexString;
  walletAddress: string;
}

interface BackendSuccess<TData> {
  ok: true;
  data: TData;
}

interface BackendError {
  error: string;
  details?: string;
}

const DEFAULT_BACKEND_URL = "http://localhost:8080";
const DEFAULT_CHAIN_ID = 10143;
const JOIN_FUNCTION_SELECTOR: HexString = "0xb688a363";

const RAW_BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;
const RAW_CHAIN_ID = import.meta.env.VITE_CHAIN_ID as string | undefined;
const RAW_JOIN_FEE_WEI = import.meta.env.VITE_JOIN_FEE_WEI as string | undefined;
const RAW_CONTRACT_ADDRESS = import.meta.env.VITE_PIZZA_RAT_CONTRACT_ADDRESS as string | undefined;

/**
 * Converts unknown thrown values into a safe UI message.
 * @param error - Unknown thrown value.
 * @returns Safe string message.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error. Please retry.";
}

/**
 * Shortens a full wallet address for compact display.
 * @param address - The full wallet address.
 * @returns A shortened display version.
 */
function shortenAddress(address: string): string {
  if (address.length < 12) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Checks if a value is a valid Ethereum address string.
 * @param value - Input value.
 * @returns True if the input is a 20-byte hex address.
 */
function isHexAddress(value: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Checks if a value is a bytes32 hex string.
 * @param value - Input value.
 * @returns True if value is 0x-prefixed and 32 bytes.
 */
function isBytes32Hex(value: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Parses the backend URL from env with fallback.
 * @returns Backend base URL.
 */
function getBackendUrl(): string {
  if (RAW_BACKEND_URL === undefined || RAW_BACKEND_URL.trim().length === 0) {
    return DEFAULT_BACKEND_URL;
  }

  return RAW_BACKEND_URL;
}

/**
 * Parses the configured chain id.
 * @returns Numeric EVM chain id.
 */
function getChainId(): number {
  if (RAW_CHAIN_ID === undefined || RAW_CHAIN_ID.trim().length === 0) {
    return DEFAULT_CHAIN_ID;
  }

  const parsed = Number.parseInt(RAW_CHAIN_ID, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_CHAIN_ID;
  }

  return parsed;
}

/**
 * Parses the configured join fee in wei.
 * @returns Join fee as bigint, or null if invalid.
 */
function getJoinFeeWei(): bigint | null {
  if (RAW_JOIN_FEE_WEI === undefined || RAW_JOIN_FEE_WEI.trim().length === 0) {
    return null;
  }

  try {
    const parsed = BigInt(RAW_JOIN_FEE_WEI);
    if (parsed <= 0n) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Parses the configured PizzaRat contract address.
 * @returns Contract address or null if invalid/unset.
 */
function getContractAddress(): string | null {
  if (RAW_CONTRACT_ADDRESS === undefined || RAW_CONTRACT_ADDRESS.trim().length === 0) {
    return null;
  }

  return isHexAddress(RAW_CONTRACT_ADDRESS) ? RAW_CONTRACT_ADDRESS : null;
}

/**
 * Selects a primary connected Ethereum wallet, preferring Privy embedded wallets.
 * @param wallets - Connected wallets available in the Privy client.
 * @returns Selected wallet or null if none exists.
 */
function selectPrimaryEthereumWallet(wallets: ConnectedWallet[]): ConnectedWallet | null {
  const embeddedWallet = wallets.find(
    (wallet) =>
      wallet.type === "ethereum" &&
      (wallet.walletClientType === "privy" || wallet.walletClientType === "privy-v2"),
  );

  if (embeddedWallet !== undefined) {
    return embeddedWallet;
  }

  return wallets.find((wallet) => wallet.type === "ethereum") ?? null;
}

/**
 * Checks if a backend payload is a success envelope.
 * @param value - Unknown payload value.
 * @returns True when payload has `ok: true` and `data`.
 */
function isBackendSuccess<TData>(value: unknown): value is BackendSuccess<TData> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true &&
    "data" in value
  );
}

/**
 * Extracts a meaningful backend error string from unknown JSON.
 * @param payload - Parsed JSON payload.
 * @param status - HTTP status code.
 * @returns Best-effort error message.
 */
function readBackendError(payload: unknown, status: number): string {
  if (typeof payload === "object" && payload !== null && "error" in payload) {
    const backendError = payload as BackendError;
    if (backendError.details !== undefined && backendError.details.length > 0) {
      return `${backendError.error}: ${backendError.details}`;
    }

    return backendError.error;
  }

  return `Backend request failed with status ${status}.`;
}

/**
 * Posts a JSON request to the backend API and returns typed data from the success envelope.
 * @param path - API path, including `/api/...`.
 * @param accessToken - Privy access token.
 * @param body - Optional request payload.
 * @returns Parsed response data.
 * @throws If the backend response is not successful.
 */
async function postBackendJson<TRequest extends object | undefined, TResponse>(
  path: string,
  accessToken: string,
  body?: TRequest,
): Promise<TResponse> {
  const response = await fetch(`${getBackendUrl()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(readBackendError(payload, response.status));
  }

  if (!isBackendSuccess<TResponse>(payload)) {
    throw new Error("Backend returned an unexpected response shape.");
  }

  return payload.data;
}

/**
 * Renders the Privy-authenticated game interaction view.
 * @returns Pizza Rat application UI.
 */
export default function App(): JSX.Element {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { sendTransaction } = useSendTransaction();

  const [actionError, setActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [lastTxHash, setLastTxHash] = useState<HexString | null>(null);
  const [registration, setRegistration] = useState<RegisterResponseData | null>(null);
  const [commitment, setCommitment] = useState<string>("0x");
  const [revealMove, setRevealMove] = useState<string>("0");
  const [revealSalt, setRevealSalt] = useState<string>("0x");

  const primaryWallet = useMemo(() => selectPrimaryEthereumWallet(wallets), [wallets]);
  const primaryWalletAddress = primaryWallet?.address ?? null;
  const hasEmbeddedPrimaryWallet =
    primaryWallet?.walletClientType === "privy" || primaryWallet?.walletClientType === "privy-v2";

  const chainId = getChainId();
  const joinFeeWei = getJoinFeeWei();
  const contractAddress = getContractAddress();

  /**
   * Runs an async action while synchronizing generic loading and error UI state.
   * @param operation - Async action to execute.
   * @returns Promise that resolves after operation completes.
   */
  const runAction = async (operation: () => Promise<void>): Promise<void> => {
    try {
      setIsBusy(true);
      setActionError(null);
      await operation();
    } catch (error: unknown) {
      setActionError(toErrorMessage(error));
    } finally {
      setIsBusy(false);
    }
  };

  /**
   * Gets a non-null Privy access token.
   * @returns Access token string.
   * @throws If token is unavailable.
   */
  const requireAccessToken = async (): Promise<string> => {
    const accessToken = await getAccessToken();
    if (accessToken === null) {
      throw new Error("No Privy access token found. Reconnect your wallet and retry.");
    }

    return accessToken;
  };

  /**
   * Opens the Privy login modal.
   * @returns Promise that resolves after login invocation.
   */
  const handleLoginClick = async (): Promise<void> => {
    await runAction(async () => {
      await login();
    });
  };

  /**
   * Logs the user out and clears session-local state.
   * @returns Promise that resolves after logout invocation.
   */
  const handleLogoutClick = async (): Promise<void> => {
    await runAction(async () => {
      await logout();
      setRegistration(null);
      setLastTxHash(null);
      setStatusMessage(null);
    });
  };

  /**
   * Registers the user wallet with the backend so relayed actions can be authorized.
   * @returns Promise that resolves after registration.
   */
  const handleRegisterClick = async (): Promise<void> => {
    await runAction(async () => {
      if (primaryWalletAddress === null) {
        throw new Error("Connect an Ethereum wallet before registering.");
      }

      const accessToken = await requireAccessToken();
      const response = await postBackendJson<RegisterRequestBody, RegisterResponseData>(
        "/api/register",
        accessToken,
        { walletAddress: primaryWalletAddress },
      );

      setRegistration(response);
      setStatusMessage(`Registered wallet ${shortenAddress(response.walletAddress)}.`);
    });
  };

  /**
   * Sends a direct `join()` transaction with the exact configured fee.
   * @returns Promise that resolves after tx submission.
   */
  const handleJoinClick = async (): Promise<void> => {
    await runAction(async () => {
      if (primaryWalletAddress === null) {
        throw new Error("Connect an Ethereum wallet before joining.");
      }
      if (contractAddress === null) {
        throw new Error("Missing or invalid VITE_PIZZA_RAT_CONTRACT_ADDRESS.");
      }
      if (joinFeeWei === null) {
        throw new Error("Missing or invalid VITE_JOIN_FEE_WEI.");
      }

      const tx = await sendTransaction(
        {
          to: contractAddress,
          data: JOIN_FUNCTION_SELECTOR,
          value: joinFeeWei,
          chainId,
        },
        {
          address: primaryWalletAddress,
          uiOptions: {
            showWalletUIs: false,
            description: "Join Pizza Rat lobby",
            buttonText: "Join",
          },
        },
      );

      setLastTxHash(tx.hash);
      setStatusMessage(`join() submitted: ${tx.hash}`);
    });
  };

  /**
   * Calls backend relayed `leave()` for the registered wallet.
   * @returns Promise that resolves after tx submission.
   */
  const handleLeaveClick = async (): Promise<void> => {
    await runAction(async () => {
      const accessToken = await requireAccessToken();
      const response = await postBackendJson<undefined, RelayActionResponseData>(
        "/api/actions/leave",
        accessToken,
      );

      setLastTxHash(response.txHash);
      setStatusMessage(`leave() submitted: ${response.txHash}`);
    });
  };

  /**
   * Calls backend relayed `commit(bytes32)` with user-provided commitment.
   * @returns Promise that resolves after tx submission.
   */
  const handleCommitClick = async (): Promise<void> => {
    await runAction(async () => {
      if (!isBytes32Hex(commitment)) {
        throw new Error("Commitment must be a 32-byte hex value (0x + 64 hex chars).");
      }

      const accessToken = await requireAccessToken();
      const response = await postBackendJson<CommitRequestBody, RelayActionResponseData>(
        "/api/actions/commit",
        accessToken,
        { commitment },
      );

      setLastTxHash(response.txHash);
      setStatusMessage(`commit() submitted: ${response.txHash}`);
    });
  };

  /**
   * Calls backend relayed `reveal(uint8,bytes32)` with user-provided move and salt.
   * @returns Promise that resolves after tx submission.
   */
  const handleRevealClick = async (): Promise<void> => {
    await runAction(async () => {
      const move = Number.parseInt(revealMove, 10);
      if (!Number.isInteger(move) || move < 0 || move > 255) {
        throw new Error("Move must be an integer between 0 and 255.");
      }
      if (!isBytes32Hex(revealSalt)) {
        throw new Error("Reveal salt must be a 32-byte hex value (0x + 64 hex chars).");
      }

      const accessToken = await requireAccessToken();
      const response = await postBackendJson<RevealRequestBody, RelayActionResponseData>(
        "/api/actions/reveal",
        accessToken,
        {
          move,
          salt: revealSalt,
        },
      );

      setLastTxHash(response.txHash);
      setStatusMessage(`reveal() submitted: ${response.txHash}`);
    });
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#fff6e4_0%,#f8e1be_35%,#f7d0aa_100%)] px-4 py-10 text-[#2f2317]">
      <section className="mx-auto flex w-full max-w-3xl flex-col gap-6 rounded-3xl border border-[#d9ae78] bg-[#fff8ec]/90 p-8 shadow-[0_16px_60px_-24px_rgba(72,43,16,0.45)] backdrop-blur">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#9a5d20]">
            Monad Testnet
          </p>
          <h1 className="text-3xl font-black leading-tight text-[#3f2a14]">
            Pizza Rat Lobby
          </h1>
          <p className="text-sm text-[#6f4d29]">
            Join is direct from wallet. Leave, commit, and reveal are submitted to your backend
            relay.
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
              <p>User: {user?.id ?? "Unknown"}</p>
              <p>
                Wallet:{" "}
                {primaryWalletAddress === null
                  ? "No Ethereum wallet found"
                  : shortenAddress(primaryWalletAddress)}
              </p>
              <p>Wallet type: {primaryWallet?.walletClientType ?? "Unknown"}</p>
              <p>Embedded wallet: {hasEmbeddedPrimaryWallet ? "Yes" : "No"}</p>
              <p>Linked wallets: {wallets.length}</p>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[#edd2ac] bg-[#fff3df] p-5 text-sm text-[#5b3b19]">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8c5a2b]">
            Runtime config
          </p>
          <p className="mt-2">Backend: {getBackendUrl()}</p>
          <p>Chain ID: {chainId}</p>
          <p>Contract: {contractAddress ?? "Missing/invalid VITE_PIZZA_RAT_CONTRACT_ADDRESS"}</p>
          <p>Join fee (wei): {joinFeeWei === null ? "Missing/invalid VITE_JOIN_FEE_WEI" : `${joinFeeWei}`}</p>
        </div>

        {registration !== null && (
          <div className="rounded-2xl border border-[#edd2ac] bg-[#fff3df] p-5 text-sm text-[#5b3b19]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8c5a2b]">
              Registration
            </p>
            <p className="mt-2">User ID: {registration.userId}</p>
            <p>Wallet ID: {registration.walletId}</p>
            <p>Wallet: {registration.walletAddress}</p>
          </div>
        )}

        {statusMessage !== null && (
          <p className="rounded-xl border border-[#2b8a3e] bg-[#effcf1] px-4 py-3 text-sm text-[#1f6a2f]">
            {statusMessage}
          </p>
        )}

        {lastTxHash !== null && (
          <p className="rounded-xl border border-[#2d5bc4] bg-[#eef4ff] px-4 py-3 text-sm text-[#123c98]">
            Last tx: {lastTxHash}
          </p>
        )}

        {actionError !== null && (
          <p className="rounded-xl border border-[#c93f20] bg-[#fff2ef] px-4 py-3 text-sm text-[#8b1b00]">
            {actionError}
          </p>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={handleLoginClick}
            disabled={!ready || authenticated || isBusy}
            className="rounded-xl bg-[#d6452e] px-5 py-2.5 text-sm font-semibold text-[#fffaf2] transition hover:bg-[#bc3a26] disabled:cursor-not-allowed disabled:bg-[#d79f94]"
          >
            Connect wallet
          </button>
          <button
            type="button"
            onClick={handleLogoutClick}
            disabled={!ready || !authenticated || isBusy}
            className="rounded-xl border border-[#ba8a54] bg-[#fff8ef] px-5 py-2.5 text-sm font-semibold text-[#7c4a1e] transition hover:bg-[#f4e3cf] disabled:cursor-not-allowed disabled:border-[#d4bc9c] disabled:text-[#b39a7e]"
          >
            Disconnect
          </button>
          <button
            type="button"
            onClick={handleRegisterClick}
            disabled={!ready || !authenticated || primaryWalletAddress === null || isBusy}
            className="rounded-xl border border-[#ba8a54] bg-[#fff8ef] px-5 py-2.5 text-sm font-semibold text-[#7c4a1e] transition hover:bg-[#f4e3cf] disabled:cursor-not-allowed disabled:border-[#d4bc9c] disabled:text-[#b39a7e]"
          >
            Register wallet
          </button>
          <button
            type="button"
            onClick={handleJoinClick}
            disabled={!ready || !authenticated || primaryWalletAddress === null || isBusy}
            className="rounded-xl bg-[#2f7a3f] px-5 py-2.5 text-sm font-semibold text-[#f6fff8] transition hover:bg-[#275f33] disabled:cursor-not-allowed disabled:bg-[#99b9a0]"
          >
            Join (pay fee)
          </button>
          <button
            type="button"
            onClick={handleLeaveClick}
            disabled={!ready || !authenticated || isBusy}
            className="rounded-xl border border-[#ba8a54] bg-[#fff8ef] px-5 py-2.5 text-sm font-semibold text-[#7c4a1e] transition hover:bg-[#f4e3cf] disabled:cursor-not-allowed disabled:border-[#d4bc9c] disabled:text-[#b39a7e]"
          >
            Leave (backend relay)
          </button>
        </div>

        <div className="rounded-2xl border border-[#edd2ac] bg-[#fff3df] p-5">
          <label className="block text-xs font-semibold uppercase tracking-[0.2em] text-[#8c5a2b]" htmlFor="commitment-input">
            Commit (backend relay)
          </label>
          <input
            id="commitment-input"
            type="text"
            value={commitment}
            onChange={(event): void => setCommitment(event.target.value.trim())}
            placeholder="0x..."
            className="mt-2 w-full rounded-xl border border-[#d6b78d] bg-[#fffdf8] px-3 py-2 text-sm text-[#5b3b19] outline-none focus:border-[#ba8a54]"
          />
          <button
            type="button"
            onClick={handleCommitClick}
            disabled={!ready || !authenticated || isBusy}
            className="mt-3 rounded-xl bg-[#7a4614] px-5 py-2.5 text-sm font-semibold text-[#fff8ef] transition hover:bg-[#61370f] disabled:cursor-not-allowed disabled:bg-[#b89a80]"
          >
            Submit commit
          </button>
        </div>

        <div className="rounded-2xl border border-[#edd2ac] bg-[#fff3df] p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8c5a2b]">
            Reveal (backend relay)
          </p>
          <div className="mt-2 grid gap-3 md:grid-cols-2">
            <input
              type="number"
              value={revealMove}
              min={0}
              max={255}
              onChange={(event): void => setRevealMove(event.target.value)}
              placeholder="move (0-255)"
              className="w-full rounded-xl border border-[#d6b78d] bg-[#fffdf8] px-3 py-2 text-sm text-[#5b3b19] outline-none focus:border-[#ba8a54]"
            />
            <input
              type="text"
              value={revealSalt}
              onChange={(event): void => setRevealSalt(event.target.value.trim())}
              placeholder="salt (0x...)"
              className="w-full rounded-xl border border-[#d6b78d] bg-[#fffdf8] px-3 py-2 text-sm text-[#5b3b19] outline-none focus:border-[#ba8a54]"
            />
          </div>
          <button
            type="button"
            onClick={handleRevealClick}
            disabled={!ready || !authenticated || isBusy}
            className="mt-3 rounded-xl bg-[#7a4614] px-5 py-2.5 text-sm font-semibold text-[#fff8ef] transition hover:bg-[#61370f] disabled:cursor-not-allowed disabled:bg-[#b89a80]"
          >
            Submit reveal
          </button>
        </div>
      </section>
    </main>
  );
}
