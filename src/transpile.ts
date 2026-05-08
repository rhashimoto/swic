// @ts-ignore
// import * as MaybeBabel from "@babel/standalone";
import * as MaybeBabel from "@babel/standalone/babel.min.js";
import { GeneratedMapping, TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

import { openDB, preamble } from "./injected.js";
import { getSourceMap } from "./sourcemap.js";

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

export interface FileRange {
  start: GeneratedMapping; // { line: number, column: number }
  end: GeneratedMapping;
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

interface CoverageMapping {
  statementMap: StatementEntry[];
  fnMap: FnEntry[];
  branchMap: BranchEntry[];
}

export interface CustomPluginOptions {
  path: string;
  sourceMap?: TraceMap;

  // Output by the plugin.
  mapping: Map<string, CoverageMapping>;
};

export async function transpile(url: URL, source: string) {
  const path = url.pathname;
  const sourceMap = await getSourceMap(url, source);

  // Patch source map source paths. The source map source paths are
  // typically relative to the output file, so add the base URL.
  if (sourceMap) {
    sourceMap.sources = sourceMap.sources.map((source) => {
      return source ? new URL(source, url).pathname : source;
    });
  }

  const opts: CustomPluginOptions = {
    path,
    sourceMap: sourceMap && new TraceMap(sourceMap),
    mapping: new Map() // placeholder, will be overwritten by the plugin
  };

  const transpiled = Babel.transform(source, {
    parserOpts: {
      strictMode: true,
      allowAwaitOutsideFunction: true,
      sourceFilename: path, // used for AST node location
    },
    // @ts-ignore
    inputSourceMap: sourceMap,
    sourceMaps: 'inline',
    filename: path, // used for state and error messages
    plugins: [[babelPlugin, opts]]
  });

  return {
    code: transpiled?.code,
    mapping: opts.mapping
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
    _swic_s[%%fileIndex%%][%%statementIndex%%]++;
  `);

  const makeFnCall = template.statement(`
    _swic_f[%%fileIndex%%][%%fnIndex%%]++;
  `);

  const makeBranchCall = template.statement(`
    _swic_b[%%fileIndex%%][%%branchIndex%%][%%branchLocationIndex%%]++;
  `);

  // There are many types of function nodes in the AST. They are all
  // handled by this common helper.
  function registerFunction(path: any) {
    // Skip statements that are not in the original source.
    const loc = path.node.loc;
    if (!loc) return;

    // Avoid instrumenting the same statement multiple times.
    if (path.getData('isVisited')) return;
    path.setData('isVisited', true);

    let fileIndex: number;
    let fnIndex: number;
    const sourceMap = opts.sourceMap;
    if (sourceMap) {
      const start = originalPositionFor(sourceMap, loc.start);
      const end = originalPositionFor(sourceMap, loc.end);

      const fnMap = opts.mapping.get(start.source!)!.fnMap;
      fileIndex = mapPathToIndex!.get(start.source!)!;
      fnIndex = fnMap.length;
      fnMap.push({
        name: path.node.id ? path.node.id.name : `anonymous_${fnIndex}`,
        line: start.line!,
        loc: {
          start: { line: start.line!, column: start.column! },
          end: { line: end.line!, column: end.column! }
        }
      });
    } else {
      const fnMap = opts.mapping.get(opts.path)!.fnMap;
      fileIndex = 0;
      fnIndex = fnMap.length;
      fnMap.push({
        name: path.node.id ? path.node.id.name : `anonymous_${fnIndex}`,
        line: loc.start.line,
        loc: {
          start: { line: loc.start.line, column: loc.start.column },
          end: { line: loc.end.line, column: loc.end.column }
        }
      });
    }

    const callExpression = makeFnCall({
      fileIndex: t.numericLiteral(fileIndex),
      fnIndex: t.numericLiteral(fnIndex),
    });
    path.get('body').insertBefore(callExpression);
  }

  return {
    visitor: {
      Program: {
        enter(path: any, state: any) {
          // Create "maps" (which are actually arrays) for each source file.
          const filePaths = [...mapPathToIndex.keys()];
          opts.mapping = new Map(filePaths.map(filePath => [filePath, {
            statementMap: [],
            fnMap: [],
            branchMap: []
          }]));
        },

        exit(path: any, state: any) {
          // Create the preamble function to prepend to the script. The
          // openDB() function is needed in both the service worker and
          // the preamble, so it is converted to a string and inlined to
          // avoid repeating the code in multiple places.
          const preambleString = preamble.toString()
            .replace('openDB()', `${openDB.toString()}()`);

          // The argument to the preamble specifies the source files and
          // the the data structures to hold the counts, which is derived
          // from the structure of the coverage maps.
          const shapes = [...mapPathToIndex.keys()].map(path => {
            return [path, {
              s: cvtCoverageMapToShape(opts.mapping.get(path)!.statementMap),
              f: cvtCoverageMapToShape(opts.mapping.get(path)!.fnMap),
              b: cvtCoverageMapToShape(opts.mapping.get(path)!.branchMap)
            }];
          });
          const shapesString = JSON.stringify(shapes);

          const makeProgramWrapper = template.statements(`
            const { s: _swic_s, f: _swic_f, b: _swic_b } =
              (${preambleString})(${shapesString});
            %%BODY%%
          `);
          path.node.body = makeProgramWrapper({
            BODY: path.node.body
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

        const opts = state.opts as Required<CustomPluginOptions>;
        const sourceMap = opts.sourceMap;

        // Add a new entry to the appropriate statement map.
        let fileIndex: number;
        let statementIndex: number;
        if (sourceMap) {
          // Use the source map to find the original location of the statement.
          const start = originalPositionFor(sourceMap, loc.start);
          const end = originalPositionFor(sourceMap, loc.end);

          const statementMap = opts.mapping.get(start.source!)!.statementMap;
          fileIndex = mapPathToIndex!.get(start.source!)!;
          statementIndex = statementMap.length;
          statementMap.push({
            start: { line: start.line!, column: start.column! },
            end: { line: end.line!, column: end.column! }
          });
        } else {
          // No source map, so just use the location in the transpiled file.
          const statementMap = opts.mapping.get(opts.path)!.statementMap;
          fileIndex = 0;
          statementIndex = statementMap.length;
          statementMap.push({
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

      FunctionDeclaration(path: any, state: any) {
        registerFunction(path);
      },

      FunctionExpression(path: any, state: any) {
        registerFunction(path);
      },

      ObjectMethod(path: any, state: any) {
        registerFunction(path);
      },
      
      ClassMethod(path: any, state: any) {
        registerFunction(path);
      },

      ArrowFunctionExpression(path: any, state: any) {
        registerFunction(path);
      }
    }
  };
}

function cvtCoverageMapToShape(cm: any) {
  return Array.isArray(cm[0]) ?
    cm.map((child: any) => cvtCoverageMapToShape(child)) :
    cm.length;
}