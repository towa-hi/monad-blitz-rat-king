import { decodeAbiParameters, type Abi, type Address, type Hex } from "viem";
import pizzaRatGameStateAbiRaw from "./abi/pizzaRatGameState.json" with { type: "json" };

/**
 * JSON-serializable round entry in game-state dump.
 */
interface RoundEntryJson {
  score: string;
  ingredients: number[];
}

/**
 * JSON-serializable player snapshot in game-state dump.
 */
interface PlayerStateJson {
  player: Address;
  alive: boolean;
  score: string;
  latestCommitHash: Hex;
  roundHistory: RoundEntryJson[];
  commitmentsByRound: Hex[];
  revealedByRound: boolean[];
}

/**
 * JSON-serializable game snapshot for backend responses.
 */
export interface GameStateJson {
  gameNumber: string;
  phase: number;
  currentRound: number;
  playerCount: number;
  phaseDeadline: string;
  recipeWad: string[];
  players: Address[];
  commitCountsByRound: number[];
  revealCountsByRound: number[];
  playerStates: PlayerStateJson[];
}

/**
 * Minimal client interface for reading contract data from chain.
 */
interface GameStateReaderClient {
  readContract(parameters: {
    address: Address;
    abi: Abi;
    functionName: string;
    args?: readonly unknown[];
  }): Promise<unknown>;
}

const GAME_STATE_ABI = pizzaRatGameStateAbiRaw as Abi;

const GAME_STATE_DUMP_PARAMETERS = [
  {
    type: "tuple",
    components: [
      { name: "gameNumber", type: "uint256" },
      { name: "phase", type: "uint8" },
      { name: "currentRound", type: "uint8" },
      { name: "playerCount", type: "uint16" },
      { name: "phaseDeadline", type: "uint64" },
      { name: "recipeWad", type: "uint256[6]" },
      { name: "players", type: "address[]" },
      { name: "commitCountsByRound", type: "uint16[]" },
      { name: "revealCountsByRound", type: "uint16[]" },
      {
        name: "playerStates",
        type: "tuple[]",
        components: [
          { name: "player", type: "address" },
          { name: "alive", type: "bool" },
          { name: "score", type: "uint256" },
          { name: "latestCommitHash", type: "bytes32" },
          {
            name: "roundHistory",
            type: "tuple[]",
            components: [
              { name: "score", type: "uint256" },
              { name: "ingredients", type: "uint8[5]" },
            ],
          },
          { name: "commitmentsByRound", type: "bytes32[]" },
          { name: "revealedByRound", type: "bool[]" },
        ],
      },
    ],
  },
] as const;

/**
 * Converts unknown values to bigint.
 * @param value - Unknown numeric value.
 * @param field - Field name for error context.
 * @returns bigint value.
 * @throws If value cannot be converted to bigint.
 */
function toBigInt(value: unknown, field: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return BigInt(value);
  }
  throw new Error(`Invalid numeric field: ${field}`);
}

/**
 * Converts unknown values to integer number.
 * @param value - Unknown numeric value.
 * @param field - Field name for error context.
 * @returns Number value.
 * @throws If value cannot be safely converted to number.
 */
function toNumber(value: unknown, field: string): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (
    typeof value === "bigint" &&
    value >= 0n &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  throw new Error(`Invalid integer field: ${field}`);
}

/**
 * Decodes ABI-encoded game-state dump into JSON-serializable object.
 * @param encodedDump - ABI bytes returned by contract.
 * @returns Structured game-state JSON object.
 * @throws If decoding fails or shape is invalid.
 */
function decodeGameStateDump(encodedDump: Hex): GameStateJson {
  const [decoded] = decodeAbiParameters(GAME_STATE_DUMP_PARAMETERS, encodedDump);
  const root = decoded as Record<string, unknown>;

  const recipeWad = (root.recipeWad as unknown[]).map((value: unknown): string =>
    toBigInt(value, "recipeWad").toString()
  );
  const players = (root.players as unknown[]).map((value: unknown): Address =>
    String(value) as Address
  );
  const commitCountsByRound = (root.commitCountsByRound as unknown[]).map(
    (value: unknown): number => toNumber(value, "commitCountsByRound"),
  );
  const revealCountsByRound = (root.revealCountsByRound as unknown[]).map(
    (value: unknown): number => toNumber(value, "revealCountsByRound"),
  );

  const playerStates = (root.playerStates as unknown[]).map(
    (stateValue: unknown): PlayerStateJson => {
      const state = stateValue as Record<string, unknown>;
      const roundHistory = (state.roundHistory as unknown[]).map(
        (entryValue: unknown): RoundEntryJson => {
          const entry = entryValue as Record<string, unknown>;
          return {
            score: toBigInt(entry.score, "roundHistory.score").toString(),
            ingredients: (entry.ingredients as unknown[]).map(
              (ingredient: unknown): number =>
                toNumber(ingredient, "roundHistory.ingredients"),
            ),
          };
        },
      );

      return {
        player: String(state.player) as Address,
        alive: Boolean(state.alive),
        score: toBigInt(state.score, "playerState.score").toString(),
        latestCommitHash: String(state.latestCommitHash) as Hex,
        roundHistory,
        commitmentsByRound: (state.commitmentsByRound as unknown[]).map(
          (commitment: unknown): Hex => String(commitment) as Hex,
        ),
        revealedByRound: (state.revealedByRound as unknown[]).map(
          (revealed: unknown): boolean => Boolean(revealed),
        ),
      };
    },
  );

  return {
    gameNumber: toBigInt(root.gameNumber, "gameNumber").toString(),
    phase: toNumber(root.phase, "phase"),
    currentRound: toNumber(root.currentRound, "currentRound"),
    playerCount: toNumber(root.playerCount, "playerCount"),
    phaseDeadline: toBigInt(root.phaseDeadline, "phaseDeadline").toString(),
    recipeWad,
    players,
    commitCountsByRound,
    revealCountsByRound,
    playerStates,
  };
}

/**
 * Queries the contract's `currentGame` storage variable and returns it as an integer.
 * This should be called before fetching game state to ensure a game exists (value >= 1).
 *
 * @param publicClient - Viem public client.
 * @param contractAddress - PizzaRat contract address.
 * @returns The current game number as an integer.
 * @throws If the contract call fails or returns a non-numeric value.
 */
export async function fetchCurrentGame(
  publicClient: GameStateReaderClient,
  contractAddress: Address,
): Promise<number> {
  const result = await publicClient.readContract({
    address: contractAddress,
    abi: GAME_STATE_ABI,
    functionName: "currentGame",
  });

  return toNumber(result, "currentGame");
}

/**
 * Reads and decodes game state dump from contract for a specific game.
 * @param publicClient - Viem public client.
 * @param contractAddress - PizzaRat contract address.
 * @param gameNumber - Game number to fetch.
 * @returns Structured game-state JSON object.
 * @throws If contract call or decoding fails.
 */
export async function fetchDecodedGameStateDump(
  publicClient: GameStateReaderClient,
  contractAddress: Address,
  gameNumber: number,
): Promise<GameStateJson> {
  const encodedDump = await publicClient.readContract({
    address: contractAddress,
    abi: GAME_STATE_ABI,
    functionName: "getGameStateDump",
    args: [BigInt(gameNumber)],
  });

  return decodeGameStateDump(encodedDump as Hex);
}
