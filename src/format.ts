import { BranchEntry, FnEntry, StatementEntry } from "./transpile";

interface CoverageMaps {
  path: string;
  statementMap: StatementEntry[];
  fnMap: FnEntry[];
  branchMap: BranchEntry[];
}

interface CoverageCounts {
  path: string;
  s: number[];
  f: number[];
  b: number[][];
}

interface IstanbulEntry {
  path: string;
  statementMap: { [key: number]: StatementEntry };
  fnMap: { [key: number]: FnEntry };
  branchMap: { [key: number]: BranchEntry };
  s: { [key: number]: number };
  f: { [key: number]: number };
  b: { [key: number]: number[] };
}

interface IstanbulReport {
  [path: string]: IstanbulEntry;
}

export async function formatIstanbul(
  { maps, counts }: { maps: CoverageMaps[]; counts: CoverageCounts[] }
): Promise<IstanbulReport> {
  // Convert to Istanbul format. This involves matching up the counts
  // with the corresponding maps, and converting arrays to objects with
  // integer keys (1-based).
  // https://github.com/gotwarlost/istanbul/blob/master/coverage.json.md
  const mapPathToMaps = new Map(maps.map((map) => [map.path, map]));
  const entries = counts.map((count) => {
    // Paths are absolute from the web server origin, but nyc will run on
    // the command line where the absolute root will be different. Convert
    // to a relative path.
    const map = mapPathToMaps.get(count.path)!;
    const relativePath = `.${count.path}`;
    const entry: IstanbulEntry = {
      path: relativePath,
      statementMap: cvtArrayToObject(map!.statementMap),
      fnMap: cvtArrayToObject(map!.fnMap),
      branchMap: cvtArrayToObject(map!.branchMap),
      s: cvtArrayToObject(count.s),
      f: cvtArrayToObject(count.f),
      b: cvtArrayToObject(count.b)
    };
    return [relativePath, entry];
  });
  return Object.fromEntries(entries);
}

function cvtArrayToObject<T>(a: Array<T>): { [key: number]: T } {
  return Object.fromEntries(a.map((value, index) => [index + 1, value]));
}