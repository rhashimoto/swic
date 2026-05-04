import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
// @ts-ignore
import * as MaybeBabel from "@babel/standalone/babel.min.js";
import { preamble } from "./injected.js";

// esbuild isn't preserving setting `globalThis.Babel` as a side effect.
// Strangely, importing the namespace works to get types in the IDE, but
// at runtime only `globalThis.Babel` works when unbundled, and only the
// namespace import works when bundled with esbuild (rollup works better
// but is slower and produces some warnings). The workaround is to check
// both places for a valid Babel object.
// https://github.com/evanw/esbuild/issues/4463#issuecomment-4367914768
// @ts-ignore
const Babel = (MaybeBabel?.transform ?
  MaybeBabel :
  (globalThis as any).Babel) as typeof MaybeBabel;

interface FileLocation {
  line: number;
  column: number;
};

interface FileRange {
  start: FileLocation;
  end: FileLocation;
};

export interface CustomPluginOptions {
  sourceMap?: TraceMap;

  // Created and used internally.
  mapPathToIndex?: Map<string, number>;
  statementMaps?: Map<string, FileRange[]>;
};

export async function transpile(path: string, encodedBody: ArrayBuffer) {
  // TODO: hash

  const source = new TextDecoder().decode(encodedBody);
  const opts: CustomPluginOptions = {
    sourceMap: undefined
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

  // TODO: Save to IndexedDB.

  return transpiled?.code;
}

export function babelPlugin(
  { template, types: t }: typeof MaybeBabel.packages,
  opts: CustomPluginOptions) {
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
          // Create the mapping from source file paths to their indices
          // in the script state.
          const opts = state.opts as CustomPluginOptions;
          if (opts.sourceMap) {
            opts.mapPathToIndex =
              new Map(opts.sourceMap.sources.map((source, index) => [source!, index]));
          } else {
            opts.mapPathToIndex =
              new Map([[path.node.loc!.filename!, 0]]);
          }

          // Create "maps" (which are actually arrays) for each source file.
          opts.statementMaps =
            new Map([...opts.mapPathToIndex.keys()].map(path => [path, []]));
        },

        exit(path: any, state: any) {
          const opts = state.opts as CustomPluginOptions;
          const sources = JSON.stringify([...opts.mapPathToIndex!.keys()]);
          const preambleString = preamble.toString()
            .replace('"createDB"', 'TODO')
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
        if (!path.node.loc) return;

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
          const start = originalPositionFor(sourceMap, path.node.loc.start);
          const end = originalPositionFor(sourceMap, path.node.loc.end);

          fileIndex = opts.mapPathToIndex!.get(start.source!)!;
          statementIndex = opts.statementMaps!.get(start.source!)!.length;
          opts.statementMaps!.get(start.source!)!.push({
            start: { line: start.line!, column: start.column! },
            end: { line: end.line!, column: end.column! }
          });
        } else {
          // No source map, so just use the location in the transpiled file.
          fileIndex = 0;
          statementIndex = opts.statementMaps!.get(path.node.loc.filename!)!.length;

          opts.statementMaps!.get(path.node.loc.filename!)!.push({
            start: { line: path.node.loc.start.line, column: path.node.loc.start.column },
            end: { line: path.node.loc.end.line, column: path.node.loc.end.column }
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