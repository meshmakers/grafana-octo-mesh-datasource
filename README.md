# OctoMesh Grafana Datasource Plugin

A Grafana datasource plugin that connects to the OctoMesh platform, enabling visualization and querying of runtime data from OctoMesh's Asset Repository service.

## Features

- **SystemQuery Execution** - Query domain models defined via OctoMesh Construction Kits
- **Time Filtering** - Automatic time range filtering with Grafana's time picker
- **Server-Side Aggregation** - Group By with Sum, Avg, Min, Max, Count functions
- **OAuth2 Authentication** - Token pass-through from Grafana to OctoMesh
- **Multi-Tenant Support** - Query data across different OctoMesh tenants

## Requirements

- Node.js 22+
- Docker & Docker Compose
- Grafana 10.4.0+
- Running OctoMesh instance with Asset Repository service

## Local Development Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Build the Plugin

```bash
# Development build with watch mode
npm run dev

# Or production build
npm run build
```

### 3. Start Grafana with the Plugin

```bash
npm run server
```

This starts Grafana Enterprise via Docker Compose with:
- Plugin mounted from `dist/` directory
- OAuth configured for OctoMesh Identity server
- Available at http://localhost:3000

### 4. Configure the Datasource

1. Open Grafana (http://localhost:3000)
2. Go to **Connections** > **Data sources** > **Add data source**
3. Search for "OctoMesh" and select it
4. Configure:
   - **OctoMesh URL**: Your Asset Repository URL (e.g., `https://assets.your-octomesh.com`)
   - **Tenant ID**: Target tenant to query
5. Click **Save & Test**

## Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Build in watch mode with live reload |
| `npm run build` | Production build |
| `npm run server` | Start Grafana Docker with plugin |
| `npm run test` | Run unit tests (watch mode) |
| `npm run test:ci` | Run tests once (CI mode) |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run e2e` | Run Playwright E2E tests |

## Reproducing CI Builds Locally

**Important:** The development build (`npm run dev`) does not catch all errors that CI catches. Before committing, always validate your changes with the full CI pipeline.

### Quick Local Validation

Run these commands in order (same as CI):

```bash
npm run typecheck   # TypeScript strict checking - catches unused imports, type errors
npm run lint        # ESLint - catches code style issues
npm run test:ci     # Unit tests
npm run build       # Production build
```

If any step fails, the CI build will also fail.

### Full CI Reproduction with Docker

For an exact CI reproduction:

```bash
# Build using the same Docker environment as CI
docker build -f devops-build/Dockerfile.build --target build .
```

### Why `npm run dev` Doesn't Catch All Errors

- `npm run dev` uses webpack with swc-loader for fast transpilation
- swc-loader does NOT perform TypeScript type checking
- `npm run typecheck` runs the full TypeScript compiler (`tsc --noEmit`)
- TypeScript strict mode catches: unused imports, unused variables, type mismatches, etc.

## Testing

### Unit Tests

```bash
# Watch mode
npm run test

# Single run
npm run test:ci
```

### E2E Tests

```bash
# Start Grafana first
npm run server

# Run E2E tests
npm run e2e
```

## Project Structure

```
src/
├── datasource.ts          # Main query execution logic
├── types.ts               # TypeScript interfaces
├── module.ts              # Plugin registration
├── plugin.json            # Plugin manifest
└── components/
    ├── ConfigEditor.tsx   # Datasource configuration UI
    └── QueryEditor.tsx    # Query builder UI

tests/                     # E2E tests (Playwright)
provisioning/              # Grafana datasource provisioning
docker-compose.yaml        # Dev environment
```

## Query Configuration

### Basic Query

1. Select a **SystemQuery** from the dropdown
2. Set **Max Rows** limit (default: 1000)
3. Optionally select a **DateTime column** for time filtering

### Aggregation (Group By)

1. Enable **Group By** toggle
2. Select columns to group by
3. Configure aggregation functions (Sum, Avg, Min, Max, Count) for numeric fields

## Building for Distribution

```bash
# Build production bundle
npm run build

# Sign plugin (requires GRAFANA_ACCESS_POLICY_TOKEN)
npm run sign
```

## Building with Docker (CI Reproducible Build)

The `devops-build/Dockerfile.build` provides a reproducible build environment identical to CI. This ensures builds work the same locally as on the build server.

### Build and Extract Artifacts

```bash
# Build and copy dist/ to local filesystem
docker build -f devops-build/Dockerfile.build --output type=local,dest=./output .

# The plugin files will be in ./output/dist/
```

### Build with Custom Version

```bash
docker build -f devops-build/Dockerfile.build --build-arg VERSION=1.2.3 --output type=local,dest=./output .
```

### Run Build Without Extracting (Validation Only)

```bash
# Just run the build to verify it passes (typecheck, lint, test, build)
docker build -f devops-build/Dockerfile.build --target build .
```

### Interactive Debugging

```bash
# Start a shell in the build container for debugging
docker build -f devops-build/Dockerfile.build --target build -t grafana-plugin-build .
docker run -it --rm grafana-plugin-build sh
```
