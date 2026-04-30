import { Minimatch } from "minimatch";

// Build a function to match paths against supplied glob patterns.
// To be successful, a path must match at least one positive pattern
// and no negative patterns.
export function buildPathMatcher(match: string[]) {
  const matchOptions = { matchBase: true, dot: true };
  const [positive, negative]: [Minimatch[], Minimatch[]] =
    match
      // Convert glob strings to minimatch objects.
      .map((pattern: string) => new Minimatch(pattern, matchOptions))
      // Separate positive and negative patterns.
      .reduce((acc: [Minimatch[], Minimatch[]], mm: Minimatch) => {
        (mm.negate ? acc[1] : acc[0]).push(mm);
        return acc;
      }, [[], []]);

  return function(path: string): boolean {
    return positive.some(mm => mm.match(path)) && negative.every(mm => mm.match(path));
  };
}