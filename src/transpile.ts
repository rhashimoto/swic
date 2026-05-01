import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { packages } from "@babel/standalone";

interface FileLocation {
  line: number;
  column: number;
};

export interface CustomPluginOptions {
  sourceMap?: TraceMap|null;
  mapPathToIndex: Map<string, number>;
  statementMap: { start: FileLocation; end: FileLocation }[];
};

export async function transpile(encodedBody: ArrayBuffer) {
  const source = new TextDecoder().decode(encodedBody);
}

export function babelPlugin(
  { template, types: t }: typeof packages,
  options: CustomPluginOptions) {
  // This function will be converted to a string and injected into the
  // instrumented code. Writing it as a real function allows using
  // IDE features and makes it easier to maintain.
  function coverage() {
  }
  const coverageString = coverage.toString().replace('"createDB"', 'TODO');

  options.mapPathToIndex = new Map();

  const makeProgramWrapper = template.statements(`
    const { __statement__, __fn__ } = (${coverageString})();
    BODY
  `, { placeholderWhitelist: new Set(['BODY']) });

  // This is the builder for the call that will be injected before
  // each statement.
  const makeStatementCall = template.statement(`
    __statement__[FILE_INDEX][STATEMENT_ID]++;
    `, { placeholderWhitelist: new Set(['FILE_INDEX', 'STATEMENT_ID']) });

  const visited = new Set<babel.Node>();
  return {
    visitor: {
      Program(path: babel.NodePath<babel.types.Program>) {
        path.node.body = makeProgramWrapper({ BODY: path.node.body });
      },

      Statement(path: babel.NodePath<babel.types.Statement>) {
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
        if (visited.has(path.node)) return;
        visited.add(path.node);

        // Use the source map, if available, to look up location.
        let fileIndex = 0;
        let start: Partial<FileLocation> = path.node.loc.start;
        let end: Partial<FileLocation> = path.node.loc.end;
        if (options.sourceMap) {
          const s = originalPositionFor(options.sourceMap, {
            line: path.node.loc.start.line,
            column: path.node.loc.start.column,
          });
          const e = originalPositionFor(options.sourceMap, {
            line: path.node.loc.end.line,
            column: path.node.loc.end.column,
          });

          fileIndex = options.mapPathToIndex.get(s.source!)!;
          start = { line: s.line!, column: s.column! };
          end = { line: e.line!, column: e.column! };
        }
        const statementId = options.statementMap.length;

        const callExpression = makeStatementCall({
          FILE_INDEX: t.numericLiteral(fileIndex),
          STATEMENT_ID: t.numericLiteral(statementId),
        });
        path.insertBefore(callExpression);
      },
    } as babel.Visitor
  };
}