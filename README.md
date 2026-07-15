# Enrichment Pipeline

A domain enrichment pipeline (NestJS + TypeScript): given a CSV of company
domains, enriches each one through a third-party data provider and writes a
structured output plus a run summary. Ships as both a CLI and an HTTP API,
sharing the same core service and provider layer.

Handles the provider's real-world rough edges — rate limiting, transient
failures, inconsistent response schemas — and is built to run against inputs
from a handful of rows to 100k+, chunked into the provider's own batch size
and resolved with bounded concurrency (a run does hold its full domain list,
and every result, in memory — see `EnrichmentRunnerService`/
`EnrichmentService` — which is a deliberate trade for keeping the responses
from one run mergeable in one place, not a streamed/constant-memory design).

## Requirements

- Node.js >= 20 (developed and tested on Node 24)
- [pnpm](https://pnpm.io/) 10.x
- Docker + Docker Compose — *optional*, only needed for the containerized
  setup further down; everything runs fine locally without it

## Major dependencies

- [`@nestjs/core`](https://nestjs.com/) — application framework (v11)
- [`nest-commander`](https://www.npmjs.com/package/nest-commander) — CLI commands on top of Nest's DI container
- [`csv-parse`](https://www.npmjs.com/package/csv-parse) — streaming CSV parsing
- [`multer`](https://www.npmjs.com/package/multer) (via `@nestjs/platform-express`) — file upload handling for the HTTP API
- [`dotenv`](https://www.npmjs.com/package/dotenv) — loads `.env` for local, non-Docker runs

## Project layout

```
src/
  enrichment/       # EnrichmentService (picks a provider, batches, merges)
                    # + EnrichmentRunnerService (extracts input, calls the service once, writes)
  domain-sources/   # extracts domains from a CSV file (a service) or a JSON array (a function)
  output-writers/   # persists a run's results (JSONL today) — chosen and constructed by the CLI/API
  providers/        # EnrichmentProvider abstraction + concrete providers (e.g. the mock provider)
  cli/              # CLI command(s), built on nest-commander
  main.ts           # HTTP API entry point
  cli.ts            # CLI entry point
starter-kit/        # take-home fixtures: mock provider, API docs, sample input
```

Each layer has one job: `domain-sources/` turns a source into domains,
`EnrichmentService` decides which provider to use and turns domains into
outcomes (chunking into that provider's batch size, running batches
concurrently, merging the results into one object), `output-writers/`
persists outcomes, and `EnrichmentRunnerService` is the coordinator that
knows about all three — extract, call the service once, write — without
owning any of their internals itself. A provider (see `providers/`) is a
single-batch primitive: given at most its own batch size worth of domains,
it resolves them (with its own retries/backoff/adaptive splitting); it has
no idea how many total domains exist for the run or how many other batches
there are.

## Setup (local, no Docker)

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Copy the env file and fill in a provider API key (any non-empty value
   works against `starter-kit/mock-provider.js`):

   ```bash
   cp .env.example .env
   ```

   Both entry points (`src/main.ts`, `src/cli.ts`) load `.env` automatically,
   so once it's filled in you don't need to export anything into your shell
   (the CLI doesn't accept provider config as flags at all — see below).

3. Start the mock provider (in its own terminal — it's a separate process,
   not something either entry point starts for you):

   ```bash
   node starter-kit/mock-provider.js   # http://localhost:4000
   ```

4. Run the HTTP API:

   ```bash
   pnpm run start:dev      # watch mode
   pnpm run build && pnpm run start:prod   # production build
   ```

   Or run the CLI:

   ```bash
   pnpm run cli enrich --input starter-kit/domains.csv --output out.jsonl
   ```

   The CLI takes no provider flags at all — `--input`/`--output` are the only
   options. Which provider runs and how it's tuned always comes from `.env`
   (`DEFAULT_ENRICHMENT_PROVIDER` plus that provider's own variables — see
   the table below), so a given `.env` always behaves the same regardless of
   who runs the command or from where.

## Setup (Docker Compose, optional)

An alternative to the local setup above — starts the mock provider and the
API together in containers, wired to talk to each other, with no manual
steps or `.env` file needed (Compose supplies the same config via
`environment:` in `docker-compose.yml`).

```bash
docker compose up --build
```

This starts:

- `mock-provider` — `starter-kit/mock-provider.js` on `http://localhost:4000`
- `api` — the NestJS HTTP API on `http://localhost:3000`, pre-configured via
  environment variables to reach `mock-provider` on the compose network

Run the CLI as a one-off against the same running stack:

```bash
docker compose run --rm api node dist/cli.js enrich \
  --input starter-kit/domains.csv \
  --output data/output.jsonl
```

`./data` is bind-mounted into the container at `/app/data`, so
`data/output.jsonl` and `data/output.jsonl.summary.json` appear on the host
once the run finishes. `./starter-kit` is mounted read-only so the sample CSV
is available inside the container without rebuilding the image.

Tear down:

```bash
docker compose down
```

## API

Both endpoints below run through the same `EnrichmentService` and return the
same `RunSummary` shape — they differ only in how domains are supplied.

### `POST /enrichments`

Multipart form upload. Runs one enrichment pass over a CSV file's `domain` column.

| Field         | Required | Description                                                              |
| ------------- | -------- | ------------------------------------------------------------------------- |
| `file`        | yes      | CSV file with a `domain` column                                          |
| `provider`    | no       | Which provider to use (default: `mock`)                                  |
| `apiKey`      | no       | Provider API key (default via `MOCK_PROVIDER_API_KEY` env var)           |
| `providerUrl` | no       | Provider base URL (default via `MOCK_PROVIDER_URL` env var)              |
| `concurrency` | no       | Max concurrent in-flight requests to the provider (default: 4)           |
| `maxRetries`  | no       | Max retry rounds on transient/rate-limited failures (default: 5)         |
| `batchSize`   | no       | Domains per provider batch call, capped at the provider's own max (default: 10) |

```bash
curl -X POST http://localhost:3000/enrichments \
  -F "file=@starter-kit/domains.csv"
```

### `POST /enrichments/domains`

JSON body — a plain array of domains, no CSV involved.

| Field         | Required | Description                                                              |
| ------------- | -------- | ------------------------------------------------------------------------- |
| `domains`     | yes      | Non-empty array of domain strings                                        |
| `provider`, `apiKey`, `providerUrl`, `concurrency`, `maxRetries`, `batchSize` | no | Same as above |

```bash
curl -X POST http://localhost:3000/enrichments/domains \
  -H "content-type: application/json" \
  -d '{"domains": ["stripe.com", "notion.so"]}'
```

### Response (both endpoints)

```json
{
  "input": "...",
  "output": "...",
  "totalRows": 39,
  "uniqueDomains": 36,
  "succeeded": 36,
  "failed": 3,
  "failuresByReason": { "INVALID_DOMAIN": 1, "NO_MATCH": 2 },
  "durationMs": 2482
}
```

The enriched output (JSONL, one record per input row) and a
`<output>.summary.json` file are written under `runs/<timestamp>/` inside the
container.

## CLI

```bash
node dist/cli.js enrich --input <path> --output <path>
```

| Flag                 | Required | Description                                                              |
| -------------------- | -------- | ------------------------------------------------------------------------- |
| `-i, --input <path>` | yes      | Path to input CSV with a `domain` column                                 |
| `-o, --output <path>`| yes      | Path to write enriched output as JSONL                                   |

No provider flags — which provider runs, and how it's tuned, comes entirely
from environment variables (see below). This is deliberate: the same command
behaves identically regardless of who runs it or from where, with no
secrets/tuning ever passed on the command line.

Output: `<output>` (JSONL, one record per input row — no silent data loss)
and `<output>.summary.json` (aggregate counts by outcome).

## Provider configuration (environment variables)

See `.env.example` (copy to `.env` for local use — Docker Compose sets these
itself).

| Variable                       | Default                 |
| ------------------------------- | ------------------------ |
| `DEFAULT_ENRICHMENT_PROVIDER`   | `mock`                   |
| `MOCK_PROVIDER_API_KEY`        | *(none — required)*      |
| `MOCK_PROVIDER_URL`            | `http://localhost:4000`  |
| `MOCK_PROVIDER_MAX_RETRIES`    | `5`                      |
| `MOCK_PROVIDER_BATCH_SIZE`     | `10`                     |
| `MOCK_PROVIDER_CONCURRENCY`    | `4`                      |
| `MOCK_PROVIDER_TIMEOUT_MS`     | `10000`                  |

The HTTP API endpoints below still accept optional per-request overrides for
a provider's tuning (not the CLI) — see the API section above.

## Tests / lint

```bash
pnpm run lint
pnpm test
pnpm run test:e2e
```
