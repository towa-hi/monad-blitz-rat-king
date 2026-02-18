#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${CONTRACTS_DIR}/.env.monad.testnet"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing env file: ${ENV_FILE}" >&2
  exit 1
fi

# shellcheck disable=SC1090
source "${ENV_FILE}"

if [[ -z "${RPC_URL:-}" ]]; then
  echo "RPC_URL is required in ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${PRIVATE_KEY:-}" ]]; then
  echo "PRIVATE_KEY is required in ${ENV_FILE}" >&2
  exit 1
fi

if [[ "${PRIVATE_KEY}" == "0xREPLACE_WITH_DEPLOYER_PRIVATE_KEY" ]]; then
  echo "Set PRIVATE_KEY in ${ENV_FILE} before deploying." >&2
  exit 1
fi

cd "${CONTRACTS_DIR}"

ACTUAL_CHAIN_ID="$(cast chain-id --rpc-url "${RPC_URL}")"
if [[ "${ACTUAL_CHAIN_ID}" != "${CHAIN_ID:-10143}" ]]; then
  echo "RPC chain ID mismatch: expected ${CHAIN_ID:-10143}, got ${ACTUAL_CHAIN_ID}" >&2
  exit 1
fi

forge script script/DeployPizzaRat.s.sol:DeployPizzaRat \
  --rpc-url "${RPC_URL}" \
  --private-key "${PRIVATE_KEY}" \
  --skip-simulation \
  --disable-code-size-limit \
  --broadcast
