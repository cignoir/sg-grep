// Query parser supporting AND(&), OR(|), NOT(-) operators
// Examples:
//   "foo bar"     → foo AND bar (space = AND)
//   "foo & bar"   → foo AND bar
//   "foo | bar"   → foo OR bar
//   "-foo"        → NOT foo
//   "foo -bar"    → foo AND NOT bar
//   "foo | bar -baz" → (foo) OR (bar AND NOT baz)

interface QueryTerm {
  type: "must" | "not";
  value: string;
}

interface ParsedQuery {
  orGroups: QueryTerm[][];
  isEmpty: boolean;
}

export function parseQuery(query: string): ParsedQuery {
  const lower = query.toLowerCase();
  const orParts = lower.split("|");

  const orGroups: QueryTerm[][] = [];

  for (const part of orParts) {
    const tokens = part.split("&").flatMap((s) => s.trim().split(/\s+/)).filter(Boolean);
    const terms: QueryTerm[] = [];

    for (const token of tokens) {
      if (token.startsWith("-") && token.length > 1) {
        terms.push({ type: "not", value: token.slice(1) });
      } else {
        terms.push({ type: "must", value: token });
      }
    }

    if (terms.length > 0) {
      orGroups.push(terms);
    }
  }

  return { orGroups, isEmpty: orGroups.length === 0 };
}

export function matchesQuery(lineLower: string, query: ParsedQuery): boolean {
  return query.orGroups.some((group) =>
    group.every((term) =>
      term.type === "must"
        ? lineLower.includes(term.value)
        : !lineLower.includes(term.value)
    )
  );
}

// Extract positive terms for highlighting
export function getHighlightTerms(query: ParsedQuery): string[] {
  const terms: string[] = [];
  for (const group of query.orGroups) {
    for (const term of group) {
      if (term.type === "must" && !terms.includes(term.value)) {
        terms.push(term.value);
      }
    }
  }
  return terms;
}

// Build a regex that highlights all positive terms
export function buildHighlightRegex(query: ParsedQuery): RegExp | null {
  const terms = getHighlightTerms(query);
  if (terms.length === 0) return null;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "gi");
}
