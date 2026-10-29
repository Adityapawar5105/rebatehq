import type { Role } from "@/lib/permissions";

const forbiddenRepKeys = new Set([
  "unitcost", "actualcostamount", "actualcostsource", "freightcost", "paymenttermscost", "cogs", "cogstotal",
  "pocketprice", "pocketmargin", "margin", "margindollar", "margindollars",
  "marginamount", "marginvalue", "freight", "terms", "costcomponent", "costcomponents"
]);

/** Fail closed if a rep response accidentally includes a protected cost or dollar-margin field. */
export function assertRepResponseSafe<T>(role: Role, payload: T): T {
  if (role !== "rep") return payload;
  const visit = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (forbiddenRepKeys.has(normalized)) throw new Error(`Protected field blocked in rep response: ${path}.${key}`);
      visit(child, `${path}.${key}`);
    }
  };
  visit(payload, "response");
  return payload;
}
