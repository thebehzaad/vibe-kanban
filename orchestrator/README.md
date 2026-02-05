# Orchestrator

TypeScript translation of the vibe-kanban Rust crates.

## Packages

| Package | Description | Rust Crate |
|---------|-------------|------------|
| `@orchestrator/db` | Database abstraction layer | `crates/db` |
| `@orchestrator/utils` | Shared utilities | `crates/utils` |
| `@orchestrator/services` | Business logic services | `crates/services` |
| `@orchestrator/executors` | AI executor integrations | `crates/executors` |
| `@orchestrator/deployment` | Deployment interface | `crates/deployment` |
| `@orchestrator/local-deployment` | Local deployment impl | `crates/local-deployment` |
| `@orchestrator/server` | HTTP API server | `crates/server` |
| `@orchestrator/remote` | Cloud deployment server | `crates/remote` |
| `@orchestrator/review` | PR review CLI | `crates/review` |

## Getting Started

```bash
# Install dependencies
cd orchestrator
pnpm install

# Build all packages
pnpm build

# Run in development mode
pnpm dev
```

## Package Dependencies

```
server
├── deployment
│   ├── services
│   │   ├── db
│   │   └── utils
│   └── db
├── executors
│   ├── db
│   └── utils
└── services

local-deployment
├── deployment
├── services
├── db
└── utils

remote
├── deployment
├── services
├── db
└── utils

review
├── services
└── utils
```

## Development

Each package follows the same structure:

```
packages/<name>/
├── package.json
├── tsconfig.json
└── src/
    └── index.ts
```

Use TypeScript project references for incremental builds:

```bash
# Build specific package
cd packages/db && pnpm build

# Build with dependencies
tsc --build packages/services
```
