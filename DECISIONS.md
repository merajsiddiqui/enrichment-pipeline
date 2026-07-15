# DECISIONS.md

Key decisions, trade-offs, and assumptions behind this enrichment pipeline —
the *why* behind what's in the code, distilled from the full working session
in `AI_LOG.md`. Kept short and real, per the brief.

## Idea, Stack, Design Pattern

**Idea.** Given a list of company domains (a handful today, up to 100k+), call
a rate-limited, occasionally-flaky third-party provider for each one, and
produce (a) a structured output file with one record per input row and (b) a
run summary an operator can act on — how many succeeded, how many failed, and
why. The same core has to work as both a CLI and an HTTP API, sharing one
code path, not two parallel implementations that can drift.

**Stack.** NestJS + TypeScript. Chosen for a real dependency-injection graph
that a CLI (`nest-commander`) and an HTTP API can share without duplicating
wiring, and because TSDoc + interfaces make the provider abstraction (below)
cheap to keep honest. `csv-parse` for streaming CSV input, `dotenv` for local
env config, `multer` (via `@nestjs/platform-express`) for the API's file
upload. No database, no queue, no ORM — none of this problem needs one.

**Design patterns, and why each one earns its place:**

- **Dependency Inversion / Strategy** — `EnrichmentService` depends only on
  the `EnrichmentProvider` interface, never a concrete provider class.
  `EnrichmentProviderManager` is the factory that maps a `ProviderType` enum
  to a concrete instance, merging environment-based defaults with per-run
  overrides. Adding a second real provider means one new class + one registry
  entry — nothing else in the app changes.
- **Template Method** — `BaseHttpEnrichmentProvider` owns everything generic
  (retry-with-backoff, item-level retry/requeue, adaptive batch-splitting on
  persistent failure, single-vs-batch endpoint routing) behind abstract hooks
  (`sendBatchRequest`/`toStandardBatchResponses`, `sendSingleRequest`/
  `toStandardSingleResponse`). `MockEnrichmentProvider` only implements the
  hooks — the wire format and resilience-mechanics stay decoupled.
- **Adapter** — every provider's raw, inconsistent response is transformed
  into one `StandardEnrichmentResponse` shape before it leaves the provider
  layer. Nothing above that layer ever sees a provider-native shape.
- **Single Responsibility, enforced as real module boundaries** — the
  codebase went through several rounds of re-splitting responsibilities
  (see `AI_LOG.md` Entries 3, 7, 8, 9) until it settled on: `domain-sources/`
  (extract domains from a CSV file or a JSON array — nothing else knows how),
  `EnrichmentService` (pick a provider, batch, call, merge — nothing else
  talks to a provider), `EnrichmentRunnerService` (extract → call the service
  once → correlate → write — the one thing CLI and API share),
  `output-writers/` (persist a run's results), `outcome-store/` (hold a run's
  in-progress results — see Scaling below). Each module has exactly one job;
  the CLI/API layer picks which concrete implementation of each to use.
- **Open/Closed** — provider registry (`Record<ProviderType, factory>`
  instead of a `switch`), output writer and outcome store as swappable
  interfaces — extending the system doesn't require editing existing,
  already-verified code.

## Assumptions

Made where the task was deliberately left ambiguous, stated here rather than
silently baked in:

- **"Threshold" (per-provider config) means an in-flight concurrency cap**
  (a semaphore), not a requests-per-second rate limiter. If the latter was
  intended, `EnrichmentProviderConfig.concurrencyThreshold` is the field to
  reinterpret.
- **The documented batch max (25) is a hard API ceiling, not a safe default.**
  Verified by testing (not by reading `mock-provider.js`'s source, which the
  assignment asks not to do): a 25-domain batch request gets `429` even after
  waiting well past any reasonable bucket-refill window, while 20 succeeds
  immediately. The rate limiter structurally can't grant a full 25-domain
  batch — it's not a timing issue. Default batch size is `10`
  (`MOCK_PROVIDER_BATCH_SIZE`), with adaptive splitting as a fallback for
  whatever the real safe ceiling turns out to be at runtime, rather than
  hardcoding a second guessed constant.
- **`NO_MATCH` is a legitimate business outcome, not a failure to retry.**
  It's reported in the output and summary like any other resolved domain,
  just with `status: "failed", reason: "NO_MATCH"` — visible, not swallowed.
- **A well-formed error body on the single-domain endpoint's 5xx response is
  a per-domain outcome, not a transport failure.** Verified empirically:
  `GET /v1/enrich?domain=` can return HTTP 500 with a well-formed
  `{status:"error", code:"TEMPORARY", retryable:true}` body — that's treated
  as one domain's retryable result, not a reason to abandon the whole
  request. (Getting this wrong was caught before it shipped — see Entry 7 —
  it would have mislabeled most transient failures as permanent after only
  2 retries instead of the configured retry budget.)
- **CLI config comes from environment only, by explicit later instruction.**
  Earlier iterations exposed `--provider`/`--api-key`/`--provider-url`/
  `--concurrency`/`--max-retries`/`--batch-size` as CLI flags; the final
  design removed all of them in favor of `.env` (`DEFAULT_ENRICHMENT_PROVIDER`
  + per-provider `MOCK_PROVIDER_*` vars), so the same command behaves
  identically regardless of who runs it or from where. The HTTP API still
  accepts most of these as optional per-request overrides — that asymmetry
  is intentional, not an oversight (the instruction to remove config was
  scoped to "the command").
- **Docker is a nice-to-have, not a requirement.** The primary, documented
  setup path is local (no Docker); Docker Compose is offered as an
  alternative, verified working, but the README doesn't imply it's required.
- **The 100k+ requirement is a design target, not something that has to
  actually run end-to-end in this exercise.** Sized data structures and
  measured memory against a synthetic 100k-row simulation instead of an
  actual 100k-domain run against the (deliberately rate-limited) mock server.
- **Invalid rows are reported, never dropped.** A malformed domain in the
  input CSV/JSON produces an output row with `status: "failed", reason:
  "INVALID_DOMAIN"` — it still costs one line in the output and one line in
  the summary, per "no silent data loss."

## Trade-offs

- **A provider-manager + enum abstraction was built for exactly one real
  provider (the mock one).** Flagged explicitly rather than silently
  justified: the assignment docks unnecessary abstraction, and a reviewer
  could reasonably ask "why generalize for N providers when there's one?"
  The counter-argument that tipped the decision: the scenario states Orbital
  calls multiple real external providers in production, so the interface
  models the actual domain, not a hypothetical. No second, fake provider was
  invented just to exercise the abstraction, though.
- **The design deliberately reversed itself on streaming vs. buffering.**
  Early iterations kept memory usage bounded by paging the input stream and
  never holding a full run's rows/results at once. A later, explicit
  instruction ("`EnrichmentService` should own batching *and* merging,
  returning one object") requires the provider's concurrency semaphore to be
  scoped to a single call across the *entire* domain list — which is only
  possible if that call happens once per run, not once per page. The two
  requirements (owned batching+merging vs. paged/streamed processing) are
  mutually exclusive; the semaphore's required scope decided which one won.
  The trade was made explicitly and measured (see Scaling), not silently
  absorbed.
- **Only a JSONL output writer was built, not CSV**, despite the original
  wording leaving open "csv or json if file is expected." A real CSV writer
  needs to flatten `industry: string[]` and a nested `location` object into
  columns — genuine, non-trivial work that wasn't clearly committed to.
  Built the `OutputWriter` seam so adding a CSV implementation later doesn't
  touch anything else, but didn't build the implementation itself.
- **A file-backed outcome store was built despite measuring that it isn't
  needed at the stated 100k scale.** A synthetic simulation of a 100k-row
  run's peak memory (input rows + dedup set + fully-merged enriched
  outcomes, all resident at once) measured ~120MB RSS — comfortably fine for
  any realistic deployment. That measurement, and the recommendation to skip
  building a disk-backed store, was surfaced before writing any code; the
  file-backed implementation was built anyway on request. Documented here so
  it's clear the code exists as an explicit choice against the evidence, not
  because the evidence was missed.
- **No test suite exists.** The assignment explicitly states it doesn't
  grade on test coverage percentage; time was spent on empirical verification
  against the live mock server instead (documented per-entry in `AI_LOG.md`)
  rather than on writing a parallel test suite. This is a real gap for a
  production system, called out rather than hidden — see Known limitations.
- **Docker Compose + a Dockerfile were built even though Docker isn't a hard
  requirement.** Extra surface area for a "don't over-engineer" exercise,
  justified because a working, reviewer-runnable container setup is cheap
  once the app itself is finished and removes "works on my machine" as a
  variable during review.

## Scaling

Designed to behave the same at ~40 domains and (on paper) 100k+, without
actually needing to run 100k domains through a deliberately rate-limited mock
server to prove it:

- **Streamed input parsing.** `CsvDomainSourceService` pipes a file read
  stream through `csv-parse` — the raw file is never loaded into memory as a
  whole, regardless of row count.
- **Deduplication before any provider call.** Domains are normalized
  (trim + lowercase) and deduped into a `Set` before enrichment — a domain
  repeated 1,000 times in a 100k-row file costs exactly one provider call,
  not 1,000.
- **Bounded concurrency, not unbounded fan-out.** `EnrichmentService` caps
  concurrent in-flight batch calls at `MOCK_PROVIDER_CONCURRENCY` via a
  semaphore — a 100k-domain run doesn't fire 100k/batch-size requests at
  once.
- **Adaptive batch sizing, not a hardcoded guess.** Rather than trusting the
  provider's documented max (25) as a safe request size, the batch size
  defaults conservatively (10) and any batch that keeps failing after quick
  retries is adaptively split in half (down to single-domain requests if
  needed) rather than assuming a fixed size is always safe.
- **Peak memory was measured, not assumed.** A synthetic simulation of a
  100k-row run's worst-case resident state — 100k input rows + a
  90k-unique-domain dedup set + a fully-merged map of realistic enriched
  company records, all held at once — came to ~120MB RSS. That's the actual
  current cost of the "buffer the run, `EnrichmentService` owns the
  batch/merge" design described above, and it's well within any realistic
  deployment target.
- **A pluggable `ResolvedOutcomeStore` exists for when ~120MB isn't
  acceptable anyway.** `InMemoryOutcomeStore` (a `Map`, default) or
  `FileOutcomeStore` (spills outcomes to a local NDJSON file, keeping only a
  `domain -> {offset, length}` index in memory — much smaller per-domain
  than a full enriched record), selected via `ENRICHMENT_OUTCOME_STORE`.
  `EnrichmentService` merges into whichever store it's given rather than
  building its own `Map`, so the choice is infrastructure, not application
  logic. Verified correct under real concurrent writes (5,000 concurrent
  `set()` calls, 0 mismatches) since multiple batches resolve concurrently.
- **What's *not* done, on purpose:** the current design still holds the full
  list of input rows (and the unique-domain set) in memory for one run —
  only the bulky enriched-outcome data is spillable today. At row counts
  well past 100k (low millions+), the rows themselves would also need to
  stop being buffered, which requires re-reading the CSV a second time for
  correlation instead of holding every row from the first pass. Not built,
  because the measured cost at the stated 100k target (~30MB for rows alone)
  doesn't justify the added complexity (a `domains` source that can be
  iterated twice instead of once) yet — see Known limitations.

## Known limitations & what's next

- **No automated tests.** Correctness was verified empirically against the
  live mock server (documented per-turn in `AI_LOG.md`) rather than with a
  Jest suite. With another day: unit tests for the retry/adaptive-split
  logic and the outcome stores (these are the parts most likely to regress
  silently), plus a couple of e2e smoke tests for the three input paths
  (CLI/CSV, API CSV-upload, API JSON-domains).
- **Only one real provider exists** (the mock one) to exercise the
  multi-provider abstraction. It's designed to extend cleanly, but "cleanly"
  is unverified against a second real implementation.
- **No CSV output writer**, only JSONL. Straightforward to add behind the
  existing `OutputWriter` interface if a CSV deliverable is actually needed.
- **Rows aren't spillable, only outcomes are.** True unbounded-scale (well
  past 100k) would need a two-pass, re-readable input source instead of
  buffering every row from a single pass.
- **The HTTP API's synchronous request/response isn't the right shape for a
  true 100k-row run over HTTP** — a client would hold the connection open
  for the whole run. Fine for the CLI and for modest/API smoke-test-sized
  requests; a real large-scale API would need an async job-queue pattern
  (submit → poll/webhook) instead.
- **`FileOutcomeStore`'s correctness relies on staying fully synchronous
  internally** (no `await` inside its critical section) to avoid needing an
  explicit lock. That's a real, load-bearing invariant documented in the
  code — anyone changing it to use async fs calls for throughput would need
  to add a real mutex around the offset-read/write/index-update sequence.
