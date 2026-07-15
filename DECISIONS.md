# Decision 1: Technology Stack

## Decision

Selected **NestJS (Node.js + TypeScript)** as the implementation stack.

## Trade-offs

- **Pros**
  - Aligns with the provided starter kit and review files.
  - Strong modular architecture and dependency injection.
  - Supports both CLI and HTTP API within the same project.
  - Familiar ecosystem and rapid development.
- **Cons**
  - Node.js is generally not the preferred choice for long-running background processing.
  - Memory management becomes an important consideration when processing very large datasets.

## Assumptions

- Staying aligned with the provided technology stack is preferable to introducing another language.
- The expected workload can be handled with proper batching and storage strategies.

## Concerns

- Large enrichment jobs (100k+ domains) require careful memory management and batching.

---

# Decision 2: Provider Abstraction

## Decision

Designed the system around a provider abstraction instead of coupling the enrichment logic to a single provider.

## Trade-offs

- **Pros**
  - Easily supports multiple enrichment vendors.
  - Provider-specific logic remains isolated.
  - Business logic stays independent of vendor implementation.
- **Cons**
  - Introduces additional abstraction compared to supporting a single provider.

## Assumptions

- The production system will integrate with multiple enrichment providers.
- Every provider has different APIs, authentication, rate limits, error codes, and response formats.

## Concerns

- The standardized enrichment response must remain flexible enough to support future providers.

---

# Decision 3: Standardized Provider Response

## Decision

Each provider transforms its native response into a common `EnrichmentResponse` model before returning data to the enrichment service.

## Trade-offs

- **Pros**
  - Business logic remains provider-agnostic.
  - Simplifies downstream processing.
  - New providers require changes only within their own implementation.
- **Cons**
  - Requires an additional transformation layer.

## Assumptions

- Vendor response formats will differ significantly.

## Concerns

- Response transformation must preserve provider-specific information where required.

---

# Decision 4: Support Both CLI and API

## Decision

Expose the enrichment functionality through both a CLI and an HTTP API while sharing the same service layer.

## Trade-offs

- **Pros**
  - No duplicated business logic.
  - Multiple consumption methods.
  - Consistent behavior across interfaces.
- **Cons**
  - Requires clear separation between transport layer and business logic.

## Assumptions

- Users may consume the service manually or programmatically.

## Concerns

- Interface-specific logic should never leak into the enrichment service.

---

# Decision 5: Separation of Concerns

## Decision

Separate responsibilities into independent components.

- CLI/API → Handle requests and responses
- CSV Service → Extract domains
- Enrichment Service → Process domains
- Provider Manager → Resolve provider
- Provider → Execute API calls
- Output Writer → Write JSON/CSV output

## Trade-offs

- **Pros**
  - Easier maintenance.
  - Better testability.
  - Components remain independently reusable.
- **Cons**
  - More modules to coordinate.

## Assumptions

- Different input and output formats may be introduced in the future.

## Concerns

- Clear ownership boundaries must be maintained.

---

# Decision 6: Batch-Based Processing

## Decision

The enrichment service operates only on a list of domains and performs provider calls according to the configured batch size.

## Trade-offs

- **Pros**
  - Provider-specific batching remains configurable.
  - Reduces API requests.
  - Easier retry management.
- **Cons**
  - Requires aggregation of multiple batch responses.

## Assumptions

- Every provider defines its own maximum batch size.

## Concerns

- Failed batches must be retried without losing successful results.

---

# Decision 7: Configurable Storage Strategy

## Decision

Support both **in-memory** and **file-backed** storage for enrichment results.

## Trade-offs

- **Memory**
  - Faster.
  - Suitable for small datasets.
- **File**
  - Lower memory consumption.
  - Better suited for large workloads.
  - Additional disk I/O overhead.

## Assumptions

- Different deployment environments may require different storage strategies.

## Concerns

- File storage introduces I/O overhead and temporary file management.

---

# Decision 8: Retry and Resilience

## Decision

Implement configurable retry logic for transient provider failures.

## Trade-offs

- **Pros**
  - Handles temporary failures gracefully.
  - Improves overall completion rate.
- **Cons**
  - Longer execution time under unstable provider conditions.

## Assumptions

- Provider failures are temporary and retryable.

## Concerns

- Retry policies must avoid overwhelming external providers.

---

# Decision 9: Logging and Debugging

## Decision

Introduce structured logging throughout the enrichment pipeline and validate implementation through iterative debugging.

## Trade-offs

- **Pros**
  - Easier troubleshooting.
  - Better visibility into provider behavior.
  - Simplifies failure analysis.
- **Cons**
  - Additional logging overhead.

## Assumptions

- Operational visibility is important for long-running enrichment jobs.

## Concerns

- Logs should provide sufficient context without becoming excessively verbose.

