import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { packages } from "@babel/standalone";

import { preamble } from "./injected.js";
import { DecodedSourceMapXInput } from "@jridgewell/trace-mapping";

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

export async function transpile(encodedBody: ArrayBuffer) {
  const source = new TextDecoder().decode(encodedBody);
}

export function babelPlugin(
  { template, types: t }: typeof packages,
  opts: CustomPluginOptions) {
  // This is the builder for the call that will be injected before
  // each statement.
  const makeStatementCall = template.statement(`
    __swicState__.s[FILE_INDEX][STATEMENT_ID]++;
    `, { placeholderWhitelist: new Set(['FILE_INDEX', 'STATEMENT_ID']) });

  return {
    visitor: {
      Program: {
        enter(
          path: babel.NodePath<babel.types.Program>,
          state: babel.PluginPass) {
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

        exit(
          path: babel.NodePath<babel.types.Program>,
          state: babel.PluginPass) {
          const opts = state.opts as CustomPluginOptions;
          const sources = JSON.stringify([...opts.mapPathToIndex!.keys()]);
          const preambleString = preamble.toString()
            .replace('"createDB"', 'TODO')
          const makeProgramWrapper = template.statements(`
            const __swicState__ = (${preambleString})(${sources});
            BODY
          `, { placeholderPattern: false, placeholderWhitelist: new Set(['BODY']) });
            path.node.body = makeProgramWrapper({
              BODY: path.node.body
            });
        }
      },

      Statement(
        path: babel.NodePath<babel.types.Statement>,
        state: babel.PluginPass) {
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
          FILE_INDEX: t.numericLiteral(fileIndex),
          STATEMENT_ID: t.numericLiteral(statementIndex),
        });
        path.insertBefore(callExpression);
      },
    } as babel.Visitor
  };
}