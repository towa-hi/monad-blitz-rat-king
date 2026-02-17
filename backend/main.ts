import { Database } from "@db/sqlite";
import {
  isEmbeddedWalletLinkedAccount,
  PrivyClient,
  type User,
  verifyAccessToken,
  type VerifyAccessTokenResponse,
} from "@privy-io/node";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddress,
} from "viem";

/**
 * Runtime configuration for the backend service.
 */
interface AppConfig {
  host: string;
  port: number;
  sqlitePath: string;
  privyAppId: string;
  privyVerificationKey: string;
  chainId: number;
  caip2: string;
  contractAddress: Address;
  privyClient: PrivyClient;
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

const PIZZA_RAT_ABI = [
  {
    type: "function",
    name: "leave",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "function",
    name: "commit",
    stateMutability: "nonpayable",
    inputs: [{ name: "commitment", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "reveal",
    stateMutability: "nonpayable",
    inputs: [
      { name: "move", type: "uint8" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

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
  const privyVerificationKey = requireEnv("PRIVY_VERIFICATION_KEY");
  const chainId = parsePositiveInteger(requireEnv("CHAIN_ID"), "CHAIN_ID");
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

  return {
    host,
    port,
    sqlitePath,
    privyAppId,
    privyVerificationKey,
    chainId,
    caip2: `eip155:${chainId}`,
    contractAddress,
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
 * Verifies a Privy access token using the configured verification key.
 * @param accessToken - Access token from request.
 * @param config - App configuration.
 * @returns Verified access token claims.
 * @throws If token is invalid.
 */
async function verifyRequestAccessToken(
  accessToken: string,
  config: AppConfig,
): Promise<VerifyAccessTokenResponse> {
  return await verifyAccessToken({
    access_token: accessToken,
    app_id: config.privyAppId,
    verification_key: config.privyVerificationKey,
  });
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
): Promise<{ accessToken: string; claims: VerifyAccessTokenResponse }> {
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
