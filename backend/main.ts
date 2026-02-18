import { Database } from "@db/sqlite";
import {
  isEmbeddedWalletLinkedAccount,
  PrivyClient,
  type User,
} from "@privy-io/node";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import {
  type Account,
  type Abi,
  type Chain,
  type Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
  type Hex,
  isAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { fetchDecodedGameStateDump, type GameStateJson } from "./gameStateDump.ts";
import pizzaRatActionsAbiRaw from "./abi/pizzaRatActions.json" with { type: "json" };

/**
 * Runtime configuration for the backend service.
 */
interface AppConfig {
  host: string;
  port: number;
  sqlitePath: string;
  privyAppId: string;
  privyJwksUrl: string;
  privyJwks: ReturnType<typeof createRemoteJWKSet>;
  adminToken: string | null;
  chainId: number;
  caip2: string;
  chain: Chain;
  rpcUrl: string;
  contractAddress: Address;
  backendAccount: Account;
  backendPublicClient: ReturnType<typeof createPublicClient>;
  backendWalletClient: ReturnType<typeof createWalletClient>;
  privyClient: PrivyClient;
}

/**
 * Verified claims required by backend routes.
 */
interface VerifiedAccessTokenClaims {
  user_id: string;
}

/**
 * SQLite row shape for a registered wallet.
 */
interface RegisteredWalletRow {
  privyUserId: string;
  walletAddress: Address;
  walletId: string;
  createdAtMs: number;
  updatedAtMs: number;
}

/**
 * Input payload expected by the register endpoint.
 */
interface RegisterRequestBody {
  walletAddress: string;
}

/**
 * Input payload expected by the commit endpoint.
 */
interface CommitRequestBody {
  commitment: string;
}

/**
 * Input payload expected by the reveal endpoint.
 */
interface RevealRequestBody {
  move: number;
  salt: string;
}

/**
 * Input payload expected by the admin close round endpoint.
 */
interface CloseRoundRequestBody {
  round: number;
}

/**
 * Input payload expected by the admin game state endpoint.
 */
interface GameStateRequestBody {
  gameNumber: number;
}

/**
 * Standard API error response body.
 */
interface ApiErrorBody {
  error: string;
  details?: string;
}

/**
 * Standard API success response wrapper.
 */
interface ApiSuccessBody<TData> {
  ok: true;
  data: TData;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ZERO_ETH_VALUE_HEX = "0x0";

const PIZZA_RAT_ABI = pizzaRatActionsAbiRaw as Abi;

const PRIVATE_KEY_HEX_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Reads a required environment variable.
 * @param name - Environment variable key.
 * @returns The non-empty environment value.
 * @throws If the variable is missing or empty.
 */
function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

/**
 * Parses and validates a positive integer from an environment string.
 * @param rawValue - String to parse.
 * @param variableName - Env variable key for error messages.
 * @returns The parsed positive integer.
 * @throws If parsing fails or value is not positive.
 */
function parsePositiveInteger(rawValue: string, variableName: string): number {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsed;
}

/**
 * Validates a 32-byte hex private key string.
 * @param rawValue - Candidate private key string.
 * @returns The validated private key string.
 * @throws If value is not a valid 32-byte hex private key.
 */
function parsePrivateKey(rawValue: string): Hex {
  if (!PRIVATE_KEY_HEX_PATTERN.test(rawValue)) {
    throw new Error("BACKEND_PRIVATE_KEY must be a 32-byte 0x-prefixed hex.");
  }

  return rawValue as Hex;
}

/**
 * Converts an Ethereum address to checksum format after validation.
 * @param walletAddress - Address to validate.
 * @returns A checksummed Ethereum address.
 * @throws If the address is invalid.
 */
export function normalizeWalletAddress(walletAddress: string): Address {
  if (!isAddress(walletAddress)) {
    throw new Error("Wallet address is not a valid Ethereum address.");
  }

  return getAddress(walletAddress);
}

/**
 * Checks whether a string is a bytes32 hex value.
 * @param value - Value to validate.
 * @returns True when value is 0x-prefixed 32-byte hex.
 */
export function isBytes32Hex(value: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

/**
 * Checks whether a number can fit in uint8.
 * @param value - Number to validate.
 * @returns True when number is an integer between 0 and 255.
 */
export function isUint8(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

/**
 * Loads backend configuration from environment variables.
 * @returns Parsed backend configuration.
 * @throws If required configuration is missing or invalid.
 */
function loadConfig(): AppConfig {
  const privyAppId = requireEnv("PRIVY_APP_ID");
  const privyAppSecret = requireEnv("PRIVY_APP_SECRET");
  const privyJwksUrl = requireEnv("PRIVY_JWKS_URL");
  const adminToken = Deno.env.get("BACKEND_ADMIN_TOKEN") ?? null;
  const chainId = parsePositiveInteger(requireEnv("CHAIN_ID"), "CHAIN_ID");
  const rpcUrl = requireEnv("RPC_URL");
  const backendPrivateKey = parsePrivateKey(requireEnv("BACKEND_PRIVATE_KEY"));
  const contractAddress = normalizeWalletAddress(
    requireEnv("PIZZA_RAT_CONTRACT_ADDRESS"),
  );

  const host = Deno.env.get("BACKEND_HOST") ?? "0.0.0.0";
  const port = parsePositiveInteger(
    Deno.env.get("BACKEND_PORT") ?? "8080",
    "BACKEND_PORT",
  );
  const sqlitePath = Deno.env.get("SQLITE_PATH") ?? "./pizza-rat.sqlite3";

  const privyClient = new PrivyClient({
    appId: privyAppId,
    appSecret: privyAppSecret,
  });
  const privyJwks = createRemoteJWKSet(new URL(privyJwksUrl));
  const chain = defineChain({
    id: chainId,
    name: `configured-chain-${chainId}`,
    network: `configured-chain-${chainId}`,
    nativeCurrency: {
      name: "Native",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
      public: {
        http: [rpcUrl],
      },
    },
  });
  const backendAccount = privateKeyToAccount(backendPrivateKey);
  const backendPublicClient = createPublicClient({
    chain,
    transport: http(rpcUrl),
  });
  const backendWalletClient = createWalletClient({
    account: backendAccount,
    chain,
    transport: http(rpcUrl),
  });

  return {
    host,
    port,
    sqlitePath,
    privyAppId,
    privyJwksUrl,
    privyJwks,
    adminToken,
    chainId,
    caip2: `eip155:${chainId}`,
    chain,
    rpcUrl,
    contractAddress,
    backendAccount,
    backendPublicClient,
    backendWalletClient,
    privyClient,
  };
}

/**
 * Opens the SQLite database and ensures required tables exist.
 * @param sqlitePath - Database file path.
 * @returns Opened SQLite database connection.
 */
function openDatabase(sqlitePath: string): Database {
  const db = new Database(sqlitePath);
  runMigrations(db);
  return db;
}

/**
 * Applies required SQLite schema migrations.
 * @param db - Opened SQLite database connection.
 * @returns Nothing.
 */
function runMigrations(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS registered_wallets (
      privy_user_id TEXT PRIMARY KEY,
      wallet_address TEXT NOT NULL UNIQUE,
      wallet_id TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )
  `);
}

/**
 * Stores or updates a registered wallet record.
 * @param db - Opened SQLite database connection.
 * @param row - Record to write.
 * @returns Nothing.
 */
function upsertRegisteredWallet(db: Database, row: RegisteredWalletRow): void {
  db.exec(
    `
      INSERT INTO registered_wallets (
        privy_user_id,
        wallet_address,
        wallet_id,
        created_at_ms,
        updated_at_ms
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(privy_user_id) DO UPDATE SET
        wallet_address = excluded.wallet_address,
        wallet_id = excluded.wallet_id,
        updated_at_ms = excluded.updated_at_ms
    `,
    [
      row.privyUserId,
      row.walletAddress,
      row.walletId,
      row.createdAtMs,
      row.updatedAtMs,
    ],
  );
}

/**
 * Gets a registered wallet row for a Privy user.
 * @param db - Opened SQLite database connection.
 * @param privyUserId - Privy user ID.
 * @returns Matching row or null if none exists.
 */
function getRegisteredWalletByUserId(
  db: Database,
  privyUserId: string,
): RegisteredWalletRow | null {
  const row = db
    .prepare(
      `
        SELECT
          privy_user_id,
          wallet_address,
          wallet_id,
          created_at_ms,
          updated_at_ms
        FROM registered_wallets
        WHERE privy_user_id = ?
      `,
    )
    .value<[string, string, string, number, number]>(privyUserId);

  if (row === undefined) {
    return null;
  }

  return {
    privyUserId: row[0],
    walletAddress: normalizeWalletAddress(row[1]),
    walletId: row[2],
    createdAtMs: row[3],
    updatedAtMs: row[4],
  };
}

/**
 * Reads a bearer token from the Authorization header.
 * @param request - Incoming request.
 * @returns Bearer token or null if missing.
 */
function extractBearerToken(request: Request): string | null {
  const authorizationHeader = request.headers.get("Authorization");
  if (authorizationHeader === null) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || token === undefined || token.length === 0) {
    return null;
  }

  return token;
}

/**
 * Verifies a Privy access token using the configured JWKS endpoint.
 * @param accessToken - Access token from request.
 * @param config - App configuration.
 * @returns Verified access token claims.
 * @throws If token is invalid.
 */
async function verifyRequestAccessToken(
  accessToken: string,
  config: AppConfig,
): Promise<VerifiedAccessTokenClaims> {
  const verified = await jwtVerify(accessToken, config.privyJwks);
  const payload = verified.payload as JWTPayload & {
    user_id?: unknown;
    app_id?: unknown;
  };

  if (!jwtAudienceIncludesAppId(payload.aud, config.privyAppId)) {
    throw new Error("Access token audience does not match PRIVY_APP_ID.");
  }
  if (
    payload.app_id !== undefined &&
    (typeof payload.app_id !== "string" || payload.app_id !== config.privyAppId)
  ) {
    throw new Error("Access token app_id claim does not match PRIVY_APP_ID.");
  }
  if (typeof payload.user_id !== "string" || payload.user_id.length === 0) {
    throw new Error("Access token is missing required user_id claim.");
  }

  return {
    user_id: payload.user_id,
  };
}

/**
 * Checks whether JWT audience claim contains the expected app id.
 * @param audience - JWT `aud` claim.
 * @param appId - Expected Privy app id.
 * @returns True when audience includes the expected app id.
 */
function jwtAudienceIncludesAppId(
  audience: JWTPayload["aud"],
  appId: string,
): boolean {
  if (typeof audience === "string") {
    return audience === appId;
  }
  if (Array.isArray(audience)) {
    return audience.some((value: unknown): boolean => value === appId);
  }
  return false;
}

/**
 * Parses JSON from an HTTP request.
 * @param request - Incoming request.
 * @returns Parsed JSON payload.
 * @throws If body is not valid JSON.
 */
async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error: unknown) {
    throw new Error(`Invalid JSON body: ${toErrorMessage(error)}`);
  }
}

/**
 * Converts unknown thrown values into a safe error string.
 * @param error - Unknown error input.
 * @returns String error message.
 */
function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * Type guard for register endpoint body.
 * @param value - Unknown parsed payload.
 * @returns True when payload shape is valid.
 */
function isRegisterRequestBody(value: unknown): value is RegisterRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "walletAddress" in value &&
    typeof value.walletAddress === "string"
  );
}

/**
 * Type guard for commit endpoint body.
 * @param value - Unknown parsed payload.
 * @returns True when payload shape is valid.
 */
function isCommitRequestBody(value: unknown): value is CommitRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "commitment" in value &&
    typeof value.commitment === "string"
  );
}

/**
 * Type guard for reveal endpoint body.
 * @param value - Unknown parsed payload.
 * @returns True when payload shape is valid.
 */
function isRevealRequestBody(value: unknown): value is RevealRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "move" in value &&
    typeof value.move === "number" &&
    "salt" in value &&
    typeof value.salt === "string"
  );
}

/**
 * Type guard for admin close round endpoint body.
 * @param value - Unknown parsed payload.
 * @returns True when payload shape is valid.
 */
function isCloseRoundRequestBody(value: unknown): value is CloseRoundRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "round" in value &&
    typeof value.round === "number"
  );
}

/**
 * Type guard for admin game-state endpoint body.
 * @param value - Unknown parsed payload.
 * @returns True when payload shape is valid.
 */
function isGameStateRequestBody(value: unknown): value is GameStateRequestBody {
  return (
    typeof value === "object" &&
    value !== null &&
    "gameNumber" in value &&
    typeof value.gameNumber === "number"
  );
}


/**
 * Creates a JSON response with CORS headers.
 * @param status - HTTP status code.
 * @param payload - Serializable response payload.
 * @returns HTTP response object.
 */
function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

/**
 * Creates a standardized JSON error response.
 * @param status - HTTP status code.
 * @param error - Error summary.
 * @param details - Optional detailed error message.
 * @returns HTTP response object.
 */
function errorResponse(
  status: number,
  error: string,
  details?: string,
): Response {
  const body: ApiErrorBody = details === undefined
    ? { error }
    : { error, details };
  return jsonResponse(status, body);
}

/**
 * Returns a 204 CORS preflight response.
 * @returns HTTP response object.
 */
function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

/**
 * Finds an embedded Ethereum wallet ID for a user and expected address.
 * @param user - Privy user object.
 * @param expectedWalletAddress - Wallet address expected by client registration.
 * @returns Embedded wallet ID.
 * @throws If no matching embedded Ethereum wallet is found.
 */
function findEmbeddedEthereumWalletId(
  user: User,
  expectedWalletAddress: Address,
): string {
  const normalizedExpectedAddress = expectedWalletAddress.toLowerCase();

  for (const linkedAccount of user.linked_accounts) {
    if (!isEmbeddedWalletLinkedAccount(linkedAccount)) {
      continue;
    }
    if (linkedAccount.chain_type !== "ethereum") {
      continue;
    }
    if (linkedAccount.address.toLowerCase() !== normalizedExpectedAddress) {
      continue;
    }
    if (linkedAccount.id === null) {
      continue;
    }

    return linkedAccount.id;
  }

  throw new Error(
    "No embedded Ethereum wallet was found for this user and wallet address. " +
      "The relayed flow requires a Privy embedded wallet.",
  );
}

/**
 * Verifies authorization and returns access token plus claims.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @returns Verified auth context.
 * @throws If bearer token is missing or invalid.
 */
async function authenticateRequest(
  request: Request,
  config: AppConfig,
): Promise<{ accessToken: string; claims: VerifiedAccessTokenClaims }> {
  const accessToken = extractBearerToken(request);
  if (accessToken === null) {
    throw new Error("Missing bearer access token.");
  }

  const claims = await verifyRequestAccessToken(accessToken, config);
  return { accessToken, claims };
}

/**
 * Validates that a user is registered and returns registration info.
 * @param db - Opened SQLite database connection.
 * @param privyUserId - Privy user ID.
 * @returns Registered wallet row.
 * @throws If the user is not registered.
 */
function requireRegisteredWallet(
  db: Database,
  privyUserId: string,
): RegisteredWalletRow {
  const registration = getRegisteredWalletByUserId(db, privyUserId);
  if (registration === null) {
    throw new Error("Wallet is not registered. Call /api/register first.");
  }

  return registration;
}

/**
 * Checks admin authorization token when configured.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @returns Nothing.
 * @throws If admin token is configured but request token is missing or invalid.
 */
function authorizeAdminRequest(request: Request, config: AppConfig): void {
  if (config.adminToken === null || config.adminToken.length === 0) {
    return;
  }

  const providedToken = request.headers.get("x-backend-token");
  if (providedToken === null || providedToken !== config.adminToken) {
    throw new Error("Unauthorized admin request.");
  }
}

/**
 * Relays an Ethereum transaction through Privy for a specific wallet.
 * @param config - App configuration.
 * @param walletId - Privy wallet ID.
 * @param accessToken - Verified user access token.
 * @param data - Calldata for the contract function invocation.
 * @returns Transaction hash.
 * @throws If relay call fails.
 */
async function relayTransaction(
  config: AppConfig,
  walletId: string,
  accessToken: string,
  data: Hex,
): Promise<Hex> {
  const result = await config.privyClient.wallets().ethereum().sendTransaction(
    walletId,
    {
      caip2: config.caip2,
      params: {
        transaction: {
          to: config.contractAddress,
          data,
          value: ZERO_ETH_VALUE_HEX,
        },
      },
      authorization_context: {
        user_jwts: [accessToken],
      },
      idempotency_key: crypto.randomUUID(),
    },
  );

  return result.hash as Hex;
}

/**
 * Simulates and submits a backend-owned `closeRound(uint8)` transaction.
 * @param config - App configuration.
 * @param round - Round index to close.
 * @returns Transaction hash.
 * @throws If simulation or transaction submission fails.
 */
async function simulateAndCloseRound(
  config: AppConfig,
  round: number,
): Promise<Hex> {
  const simulation = await config.backendPublicClient.simulateContract({
    address: config.contractAddress,
    abi: PIZZA_RAT_ABI,
    functionName: "closeRound",
    args: [round],
    account: config.backendAccount,
  });

  return await config.backendWalletClient.writeContract(simulation.request);
}

/**
 * Reads and decodes game state dump from contract for a specific game.
 * @param config - App configuration.
 * @param gameNumber - Game number to fetch.
 * @returns Structured game-state JSON object.
 * @throws If contract call or decoding fails.
 */
/**
 * Handles wallet registration.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @param db - Opened SQLite database connection.
 * @returns HTTP response.
 */
async function handleRegister(
  request: Request,
  config: AppConfig,
  db: Database,
): Promise<Response> {
  const { claims } = await authenticateRequest(request, config);
  const payload = await parseJsonBody(request);
  if (!isRegisterRequestBody(payload)) {
    return errorResponse(
      400,
      "Invalid request body.",
      "Expected { walletAddress: string }.",
    );
  }

  const walletAddress = normalizeWalletAddress(payload.walletAddress);
  const user = await config.privyClient.users()._get(claims.user_id);
  const walletId = findEmbeddedEthereumWalletId(user, walletAddress);
  const now = Date.now();

  upsertRegisteredWallet(db, {
    privyUserId: claims.user_id,
    walletAddress,
    walletId,
    createdAtMs: now,
    updatedAtMs: now,
  });

  const responseBody: ApiSuccessBody<{
    userId: string;
    walletAddress: Address;
    walletId: string;
    updatedAtMs: number;
  }> = {
    ok: true,
    data: {
      userId: claims.user_id,
      walletAddress,
      walletId,
      updatedAtMs: now,
    },
  };

  return jsonResponse(200, responseBody);
}

/**
 * Handles the leave relay endpoint.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @param db - Opened SQLite database connection.
 * @returns HTTP response.
 */
async function handleLeave(
  request: Request,
  config: AppConfig,
  db: Database,
): Promise<Response> {
  const { accessToken, claims } = await authenticateRequest(request, config);
  const registration = requireRegisteredWallet(db, claims.user_id);
  const calldata = encodeFunctionData({
    abi: PIZZA_RAT_ABI,
    functionName: "leave",
    args: [],
  });
  const txHash = await relayTransaction(
    config,
    registration.walletId,
    accessToken,
    calldata,
  );

  const responseBody: ApiSuccessBody<{
    action: "leave";
    txHash: Hex;
    walletAddress: Address;
  }> = {
    ok: true,
    data: {
      action: "leave",
      txHash,
      walletAddress: registration.walletAddress,
    },
  };

  return jsonResponse(200, responseBody);
}

/**
 * Handles the commit relay endpoint.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @param db - Opened SQLite database connection.
 * @returns HTTP response.
 */
async function handleCommit(
  request: Request,
  config: AppConfig,
  db: Database,
): Promise<Response> {
  const { accessToken, claims } = await authenticateRequest(request, config);
  const registration = requireRegisteredWallet(db, claims.user_id);
  const payload = await parseJsonBody(request);
  if (!isCommitRequestBody(payload)) {
    return errorResponse(
      400,
      "Invalid request body.",
      "Expected { commitment: bytes32 hex string }.",
    );
  }
  if (!isBytes32Hex(payload.commitment)) {
    return errorResponse(
      400,
      "Invalid commitment.",
      "Commitment must be a 32-byte hex value.",
    );
  }

  const calldata = encodeFunctionData({
    abi: PIZZA_RAT_ABI,
    functionName: "commit",
    args: [payload.commitment as Hex],
  });
  const txHash = await relayTransaction(
    config,
    registration.walletId,
    accessToken,
    calldata,
  );

  const responseBody: ApiSuccessBody<{
    action: "commit";
    txHash: Hex;
    walletAddress: Address;
  }> = {
    ok: true,
    data: {
      action: "commit",
      txHash,
      walletAddress: registration.walletAddress,
    },
  };

  return jsonResponse(200, responseBody);
}

/**
 * Handles the reveal relay endpoint.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @param db - Opened SQLite database connection.
 * @returns HTTP response.
 */
async function handleReveal(
  request: Request,
  config: AppConfig,
  db: Database,
): Promise<Response> {
  const { accessToken, claims } = await authenticateRequest(request, config);
  const registration = requireRegisteredWallet(db, claims.user_id);
  const payload = await parseJsonBody(request);
  if (!isRevealRequestBody(payload)) {
    return errorResponse(
      400,
      "Invalid request body.",
      "Expected { move: uint8 number, salt: bytes32 hex string }.",
    );
  }
  if (!isUint8(payload.move)) {
    return errorResponse(
      400,
      "Invalid move.",
      "Move must be an integer in [0, 255].",
    );
  }
  if (!isBytes32Hex(payload.salt)) {
    return errorResponse(
      400,
      "Invalid salt.",
      "Salt must be a 32-byte hex value.",
    );
  }

  const calldata = encodeFunctionData({
    abi: PIZZA_RAT_ABI,
    functionName: "reveal",
    args: [payload.move, payload.salt as Hex],
  });
  const txHash = await relayTransaction(
    config,
    registration.walletId,
    accessToken,
    calldata,
  );

  const responseBody: ApiSuccessBody<{
    action: "reveal";
    txHash: Hex;
    walletAddress: Address;
  }> = {
    ok: true,
    data: {
      action: "reveal",
      txHash,
      walletAddress: registration.walletAddress,
    },
  };

  return jsonResponse(200, responseBody);
}

/**
 * Handles backend-triggered close-round operation.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @returns HTTP response.
 */
async function handleAdminCloseRound(
  request: Request,
  config: AppConfig,
): Promise<Response> {
  authorizeAdminRequest(request, config);
  const payload = await parseJsonBody(request);
  if (!isCloseRoundRequestBody(payload)) {
    return errorResponse(
      400,
      "Invalid request body.",
      "Expected { round: uint8 number }.",
    );
  }
  if (!isUint8(payload.round) || payload.round === 0) {
    return errorResponse(
      400,
      "Invalid round.",
      "Round must be an integer in [1, 255].",
    );
  }

  const txHash = await simulateAndCloseRound(config, payload.round);
  const responseBody: ApiSuccessBody<{
    action: "closeRound";
    round: number;
    txHash: Hex;
  }> = {
    ok: true,
    data: {
      action: "closeRound",
      round: payload.round,
      txHash,
    },
  };

  return jsonResponse(200, responseBody);
}

/**
 * Handles backend game-state dump endpoint.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @returns HTTP response.
 */
async function handleAdminGameState(
  request: Request,
  config: AppConfig,
): Promise<Response> {
  authorizeAdminRequest(request, config);
  const payload = await parseJsonBody(request);
  if (!isGameStateRequestBody(payload)) {
    return errorResponse(
      400,
      "Invalid request body.",
      "Expected { gameNumber: non-negative integer }.",
    );
  }
  if (!Number.isInteger(payload.gameNumber) || payload.gameNumber < 0) {
    return errorResponse(
      400,
      "Invalid game number.",
      "gameNumber must be a non-negative integer.",
    );
  }

  const gameState = await fetchDecodedGameStateDump(
    config.backendPublicClient,
    config.contractAddress,
    payload.gameNumber,
  );
  const responseBody: ApiSuccessBody<{
    action: "gameState";
    gameNumber: number;
    gameState: GameStateJson;
  }> = {
    ok: true,
    data: {
      action: "gameState",
      gameNumber: payload.gameNumber,
      gameState,
    },
  };

  return jsonResponse(200, responseBody);
}

/**
 * Handles all HTTP requests for the backend API.
 * @param request - Incoming request.
 * @param config - App configuration.
 * @param db - Opened SQLite database connection.
 * @returns HTTP response.
 */
async function routeRequest(
  request: Request,
  config: AppConfig,
  db: Database,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return corsPreflightResponse();
  }

  const { pathname } = new URL(request.url);

  try {
    if (request.method === "GET" && pathname === "/health") {
      return jsonResponse(200, { ok: true, status: "healthy" });
    }

    if (request.method === "POST" && pathname === "/api/register") {
      return await handleRegister(request, config, db);
    }

    if (request.method === "POST" && pathname === "/api/actions/leave") {
      return await handleLeave(request, config, db);
    }

    if (request.method === "POST" && pathname === "/api/actions/commit") {
      return await handleCommit(request, config, db);
    }

    if (request.method === "POST" && pathname === "/api/actions/reveal") {
      return await handleReveal(request, config, db);
    }

    if (request.method === "POST" && pathname === "/api/admin/close-round") {
      return await handleAdminCloseRound(request, config);
    }

    if (request.method === "POST" && pathname === "/api/admin/game-state") {
      return await handleAdminGameState(request, config);
    }

    if (pathname.startsWith("/api/")) {
      return errorResponse(405, "Method or route not allowed.");
    }

    return errorResponse(404, "Route not found.");
  } catch (error: unknown) {
    return errorResponse(400, "Request failed.", toErrorMessage(error));
  }
}

/**
 * Starts the backend HTTP server.
 * @returns Nothing.
 * @throws If configuration fails.
 */
function startServer(): void {
  const config = loadConfig();
  const db = openDatabase(config.sqlitePath);

  Deno.serve(
    {
      hostname: config.host,
      port: config.port,
    },
    (request: Request): Promise<Response> => routeRequest(request, config, db),
  );

  console.log(
    `Pizza Rat backend listening on http://${config.host}:${config.port}`,
  );
}

if (import.meta.main) {
  startServer();
}
