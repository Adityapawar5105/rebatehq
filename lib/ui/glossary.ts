// Finance glossary terms (chunk 7U). Each id has `glossary.<id>` (the term) and
// `glossary.<id>.def` (a plain-language definition) in every language catalog.
export const TERMS = ["listPrice", "discount", "rebate", "freight", "pocketPrice", "netPocket", "returnsCredits", "cost", "pocketMargin", "marginRate", "waterfall", "whaleCurve", "leak", "peerRate", "guardrail", "floor", "tier", "costBasis", "replacementCost", "reconciliation", "fixLater", "itemMaster", "uom", "pricingOwner", "simulation", "roi", "auditChain"] as const;
export type TermId = typeof TERMS[number];
