export interface Config {
  isEnabled: boolean;
  match: string[];
}

export interface FileLocation {
  line: number;
  column: number;
}

export interface FileRange {
  start: FileLocation;
  end: FileLocation;
}

export interface BranchRange extends FileRange { skip?: true }; // always true if present

export interface StatementEntry extends FileRange {};
export interface FnEntry {
  name: string;
  line: number;
  loc: FileRange;
  skip?: true; // always true if present
};
export interface BranchEntry {
  line: number;
  type: string;
  locations: BranchRange[];
};

export interface CoverageMaps {
  path?: string;
  statementMap: StatementEntry[];
  fnMap: FnEntry[];
  branchMap: BranchEntry[];
}

export interface CoverageCounts {
  path?: string;
  s: number[];
  f: number[];
  b: number[][];
}
