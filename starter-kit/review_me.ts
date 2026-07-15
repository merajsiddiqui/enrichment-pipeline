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
// REVIEW:  I would suggest  getting it from .env 
const PROVIDER_TOKEN = "demo-token-abc123";

// REVIEW: No functional comments 
export async function enrichDomains(domains: string[]): Promise<Company[]> {
 // REVIEW: Never log token in logs 
  console.log(`Enriching ${domains.length} domains with token ${PROVIDER_TOKEN}`);

  // REVIEW: When the batch mechanism is in place and api supports batch call one should utilise that to reduce
  // Extra api calls which are not required, Which will save outbound call, request time and processing time 

  const results = await Promise.all(
    domains.map(async (domain) => {
      while (true) {
        try {
          const res = await fetch(`${PROVIDER_URL}/v1/enrich?domain=${domain}`, {
            headers: { Authorization: `Bearer ${PROVIDER_TOKEN}` },
          });
          // REVIEW:  Just continue without any mechanism does'nt do any good, One must follow some mechanism 
          // to decide when to retry, how many times to retry, how much interval should be applied before retry and when to stop retry 
          if (res.status === 429 || res.status >= 500) {
            // Provider is busy or erroring — just try again.
            continue;
          }

          // REVIEW:  A defined data type will help to identify  what keys are there rather than explicit any 
          const body: any = await res.json();
          const data = body.data;

          // REVIEW: We don't k now what keys are available in data  giving undefined values in runtime 
          return {
            domain: data.domain,
            name: data.name,  // REVIEW:   companyName: 'Abc'  there is no key name
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
