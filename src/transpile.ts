// @ts-ignore
import * as MaybeBabel from "@babel/standalone";
// import * as MaybeBabel from "@babel/standalone/babel.min.js";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

import { openDB, preamble } from "./injected.js";

// esbuild isn't preserving setting `globalThis.Babel` as a side effect.
// Strangely, importing the namespace works to get types in the IDE, but
// at runtime only `globalThis.Babel` works when unbundled, and only the
// namespace import works when bundled with esbuild (rollup works better
// but is slower and produces some warnings). The workaround is to check
// both places for a valid Babel object.
// https://github.com/evanw/esbuild/issues/4463
// @ts-ignore
const Babel = (MaybeBabel?.transform ?
  MaybeBabel :
  (globalThis as any).Babel) as typeof MaybeBabel;

export interface FileLocation {
  line: number;
  column: number;
};

export interface FileRange {
  start: FileLocation;
  end: FileLocation;
};

export interface StatementEntry extends FileRange {};
interface BranchRange extends FileRange { skip?: true }; // always true if present

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

export interface CustomPluginOptions {
  path: string;
  sourceMap?: TraceMap;

  // Output by the plugin.
  statementMaps?: Map<string, StatementEntry[]>;
  fnMaps?: Map<string, FnEntry[]>;
  branchMaps?: Map<string, BranchEntry[]>;
};

export async function transpile(path: string, source: string) {
  const opts: CustomPluginOptions = {
    path,
    sourceMap: undefined // TODO
  };

  const transpiled = Babel.transform(source, {
    parserOpts: {
      strictMode: true,
      allowAwaitOutsideFunction: true,
      sourceFilename: path, // used for AST node location
    },
    inputSourceMap: undefined,
    sourceMaps: 'inline',
    filename: path, // used for state and error messages
    plugins: [[babelPlugin, opts]]
  });

  return {
    code: transpiled?.code,
    statementMaps: opts.statementMaps!,
    fnMaps: opts.fnMaps!,
    branchMaps: opts.branchMaps!
  };
}

export function babelPlugin(
  { template, types: t }: typeof MaybeBabel.packages,
  opts: CustomPluginOptions) {
  const mapPathToIndex: Map<string, number> = new Map();
  if (opts.sourceMap) {
    opts.sourceMap.sources.forEach((source, index) => {
      mapPathToIndex.set(source!, index);
    });
  } else {
    mapPathToIndex.set(opts.path, 0);
  }

  // This is the builder for the call that will be injected before
  // each statement.
  const makeStatementCall = template.statement(`
    _swic_s[%%fileIndex%%][%%statementIndex%%] =
      (_swic_s[%%fileIndex%%][%%statementIndex%%] ?? 0) + 1;
    `);
  return {
    visitor: {
      Program: {
        enter(path: any, state: any) {
          // Create "maps" (which are actually arrays) for each source file.
          const filePaths = [...mapPathToIndex.keys()];
          opts.statementMaps = new Map(filePaths.map(filePath => [filePath, []]));
          opts.fnMaps = new Map(filePaths.map(filePath => [filePath, []]));
          opts.branchMaps = new Map(filePaths.map(filePath => [filePath, []]));
        },

        exit(path: any, state: any) {
          const preambleString = preamble.toString()
            .replace('openDB()', `${openDB.toString()}()`);
          const sources = JSON.stringify([...mapPathToIndex!.keys()]);
          
          const makeProgramWrapper = template.statements(`
            const { s: _swic_s, f: _swic_f, b: _swic_b } = (${preambleString})(${sources});
            %%body%%
          `);
          path.node.body = makeProgramWrapper({
            body: path.node.body
          });
        }
      },

      Statement(path: any, state: any) {
        // Skip statements that are not in the original source.
        const loc = path.node.loc;
        if (!loc) return;

        // Skip non-executable or invalid insertion points.
        if (path.isBlockStatement() ||
            path.isEmptyStatement() ||
            path.isImportDeclaration() ||
            path.isExportDeclaration()) return;

        // Skip statements where insertBefore is not valid.
        if ((path.parentPath.isForStatement() && path.key === "init") ||
            (path.parentPath.isForInStatement() && path.key === "left") ||
            (path.parentPath.isForOfStatement() && path.key === "left")) return;

        // Avoid instrumenting the same statement multiple times.
        if (path.getData('isVisited')) return;
        path.setData('isVisited', true);

        const opts = state.opts as CustomPluginOptions;
        const sourceMap = opts.sourceMap;

        // Add a new entry to the appropriate statement map.
        let fileIndex: number;
        let statementIndex: number;
        if (sourceMap) {
          // Use the source map to find the original location of the statement.
          const start = originalPositionFor(sourceMap, loc.start);
          const end = originalPositionFor(sourceMap, loc.end);

          fileIndex = mapPathToIndex!.get(start.source!)!;
          statementIndex = opts.statementMaps!.get(start.source!)!.length;
          opts.statementMaps!.get(start.source!)!.push({
            start: { line: start.line!, column: start.column! },
            end: { line: end.line!, column: end.column! }
          });
        } else {
          // No source map, so just use the location in the transpiled file.
          fileIndex = 0;
          statementIndex = opts.statementMaps!.get(opts.path)!.length;

          opts.statementMaps!.get(opts.path)!.push({
            start: { line: loc.start.line, column: loc.start.column },
            end: { line: loc.end.line, column: loc.end.column }
          });
        }

        // Inject the call to increment the statement count.
        const callExpression = makeStatementCall({
          fileIndex: t.numericLiteral(fileIndex),
          statementIndex: t.numericLiteral(statementIndex),
        });
        path.insertBefore(callExpression);
      },
    }
  };
}