// review_me.ts
//
// PART B — Code review.
//
// A teammate generated the function below with an AI assistant and opened a PR.
// It "works" against the mock provider for a handful of domains and they'd like
// to merge it. Review it as you would a real PR: leave comments inline (a `//
// REVIEW:` line above the relevant code is fine) covering correctness, scale,
// data quality, failure handling, and anything else you'd block or push back on.
//
// You do NOT need to rewrite it. We care about what you catch and how you
// prioritize it. Do not run it against the provider before reading it — read
// first, the way you would in a real review.

type Company = {
  domain: string;
  name: string;
  employees: number;
  industry: string | string[];
};

const PROVIDER_URL = "http://localhost:4000";
const PROVIDER_TOKEN = "demo-token-abc123";

export async function enrichDomains(domains: string[]): Promise<Company[]> {
  console.log(`Enriching ${domains.length} domains with token ${PROVIDER_TOKEN}`);

  const results = await Promise.all(
    domains.map(async (domain) => {
      while (true) {
        try {
          const res = await fetch(`${PROVIDER_URL}/v1/enrich?domain=${domain}`, {
            headers: { Authorization: `Bearer ${PROVIDER_TOKEN}` },
          });

          if (res.status === 429 || res.status >= 500) {
            // Provider is busy or erroring — just try again.
            continue;
          }

          const body: any = await res.json();
          const data = body.data;

          return {
            domain: data.domain,
            name: data.name,
            employees: parseInt(data.employeeCount),
            industry: data.industry,
          };
        } catch (e) {
          return null;
        }
      }
    })
  );

  return results.filter(Boolean) as Company[];
}
