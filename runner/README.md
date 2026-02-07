# runner

TypeScript translation of the vibe-kanban Rust crates.

## Packages

| Package | Description | Rust Crate |
|---------|-------------|------------|
| `@runner/db` | Database abstraction layer | `crates/db` |
| `@runner/utils` | Shared utilities | `crates/utils` |
| `@runner/services` | Business logic services | `crates/services` |
| `@runner/executors` | AI executor integrations | `crates/executors` |
| `@runner/deployment` | Deployment interface | `crates/deployment` |
| `@runner/local-deployment` | Local deployment impl | `crates/local-deployment` |
| `@runner/server` | HTTP API server | `crates/server` |
| `@runner/remote` | Cloud deployment server | `crates/remote` |
| `@runner/review` | PR review CLI | `crates/review` |

## Getting Started

```bash
# Install dependencies
cd runner
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
