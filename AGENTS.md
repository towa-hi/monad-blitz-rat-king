# AGENTS.md

## Project Structure

```
monad-blitz-rat-king/
├── backend/            # Deno backend service
│   └── main.ts         # Entry point
├── contracts/          # Foundry smart contracts
│   ├── src/            # Contract source files
│   ├── test/           # Contract tests
│   ├── script/         # Deployment scripts
│   └── lib/            # Dependencies (git submodules)
└── frontend/           # Vite web application
    ├── src/            # TypeScript source files
    └── public/         # Static assets
```

## Contracts (Foundry)

- **Framework**: Foundry
- **Language**: Solidity
- **Config**: `contracts/foundry.toml`

### Commands
```bash
cd contracts
forge build      # Compile contracts
forge test       # Run tests
forge fmt        # Format code
```

## Backend (Deno)

- **Runtime**: Deno
- **Language**: TypeScript
- **Web3**: viem
- **Config**: `backend/deno.json`

### Commands
```bash
cd backend
deno run main.ts    # Run the program
deno task dev       # Run with watch mode
deno test           # Run tests
```

## Frontend (Vite + TypeScript)

- **Framework**: Vite
- **Language**: TypeScript (vanilla)
- **Styling**: Tailwind CSS
- **Web3**: viem

### Commands
```bash
cd frontend
npm run dev      # Start dev server
npm run build    # Build for production
npm run preview  # Preview production build
```

## TypeScript Conventions (Frontend & Backend)

### Strict Typing
- Strict mode is enabled; do not disable any strict checks
- Never use `any` type; use `unknown` with type guards or proper generics instead
- All function parameters and return types must be explicitly typed

### Documentation
- Every function must have a JSDoc comment describing its purpose
- Include `@param` and `@returns` tags for all parameters and return values
- Document thrown exceptions with `@throws`

### Error Handling
- All async operations must have explicit error handling
- Never swallow errors silently; log or propagate them
- Use try/catch blocks around external calls (API, blockchain, storage)
- Validate inputs at function boundaries
- Provide meaningful error messages for debugging

## Conventions

- Single `.gitignore` at project root covers all subprojects
- Environment variables use `.env` files (not committed)
- Foundry dependencies managed via git submodules in `contracts/lib/`
- Frontend dependencies managed via npm in `frontend/`
- Backend dependencies managed via deno.json imports in `backend/`
