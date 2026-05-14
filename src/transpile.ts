// @ts-ignore
// import * as MaybeBabel from "@babel/standalone";
import * as MaybeBabel from "@babel/standalone/babel.min.js";
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { type CoverageMaps } from "./types/index.js";

import { preamble } from "./injected.js";
import { openIDB } from "./persistence.js";
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

export interface CustomPluginOptions {
  path: string;
  sourceMap?: TraceMap;

  // Output by the plugin.
  mapping: Map<string, CoverageMaps>;
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
  const makeStmtInjection = template.statement(`
    _swic_s[%%fileIndex%%][%%statementIndex%%]++;
  `);

  const makeFnInjection = template.statement(`
    _swic_f[%%fileIndex%%][%%fnIndex%%]++;
  `);

  const makeBranchExpr = template.expression(`
    (_swic_b[%%fileIndex%%][%%branchIndex%%][%%branchLocationIndex%%]++, %%originalExpr%%)
  `);

  const makeBranchStmt = template.statement(`
    _swic_b[%%fileIndex%%][%%branchIndex%%][%%branchLocationIndex%%]++;
  `);

  // There are many types of function nodes in the AST. They are all
  // handled by this common helper.
  function registerFn(path: any) {
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
      if (!start.source || !end.source) {
        // This can happen if the function is not in the original source,
        // such as an injected function from a plugin. In that case, skip
        // instrumentation.
        return;
      }

      const fnMap = opts.mapping.get(start.source)!.fnMap;
      fileIndex = mapPathToIndex!.get(start.source)!;
      fnIndex = fnMap.length;
      fnMap.push({
        name: path.node.id ? path.node.id.name : `anonymous_${fnIndex}`,
        line: start.line!,
        loc: {
          start: { line: start.line, column: start.column },
          end: { line: end.line, column: end.column }
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

    const injection = makeFnInjection({
      fileIndex: t.numericLiteral(fileIndex),
      fnIndex: t.numericLiteral(fnIndex),
    });
    path.get('body').insertBefore(injection);
  }

  function registerBranch(path: any, type: string, childPaths: any[]) {
    // Skip statements that are not in the original source.
    const loc = path.node.loc;
    if (!loc) return;

    // Avoid instrumenting the same branch multiple times.
    if (path.getData('isVisited')) return;
    path.setData('isVisited', true);

    // Skip if no child paths to process
    if (childPaths.length === 0) return;

    let fileIndex: number;
    let branchIndex: number;
    const sourceMap = opts.sourceMap;
    const branchLocations: any[] = [];

    if (sourceMap) {
      const start = originalPositionFor(sourceMap, loc.start);
      const end = originalPositionFor(sourceMap, loc.end);
      if (!start.source || !end.source) {
        // This can happen if the branch is not in the original source,
        // such as an injected branch from a plugin. In that case, skip
        // instrumentation.
        return;
      }

      const branchMap = opts.mapping.get(start.source)!.branchMap;
      fileIndex = mapPathToIndex!.get(start.source)!;
      branchIndex = branchMap.length;

      // Populate locations for each child path
      for (const childPath of childPaths) {
        const loc = childPath.node.loc;
        if (loc) {
          const start = originalPositionFor(sourceMap, loc.start);
          const end = originalPositionFor(sourceMap, loc.end);
          branchLocations.push({
            start: { line: start.line, column: start.column },
            end: { line: end.line, column: end.column }
          });
        }
      }

      branchMap.push({
        type,
        line: start.line!,
        locations: branchLocations
      });
    } else {
      const branchMap = opts.mapping.get(opts.path)!.branchMap;
      fileIndex = 0;
      branchIndex = branchMap.length;

      // Populate locations for each child path
      for (const childPath of childPaths) {
        const loc = childPath.node.loc;
        if (loc) {
          branchLocations.push({
            start: { line: loc.start.line, column: loc.start.column },
            end: { line: loc.end.line, column: loc.end.column }
          });
        }
      }

      branchMap.push({
        type,
        line: loc.start.line,
        locations: branchLocations
      });
    }

    // Inject instrumentation code for each branch path
    for (let i = 0; i < childPaths.length; i++) {
      const childPath = childPaths[i];
      if (childPath.isExpression()) {
        // For expressions, we need to replace them with a sequence expression
        // that includes the original expression and the instrumentation call.
        const injectionExpr = makeBranchExpr({
          fileIndex: t.numericLiteral(fileIndex),
          branchIndex: t.numericLiteral(branchIndex),
          branchLocationIndex: t.numericLiteral(i),
          originalExpr: childPath.node
        });
        childPath.replaceWith(injectionExpr);
      } else {
        const injectionStmt = makeBranchStmt({
          fileIndex: t.numericLiteral(fileIndex),
          branchIndex: t.numericLiteral(branchIndex),
          branchLocationIndex: t.numericLiteral(i)
        });
        childPath.insertBefore(injectionStmt);
      }
    }
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
          // openIDB() function is needed in both the service worker and
          // the preamble, so it is converted to a string and inlined to
          // avoid repeating the code in multiple places.
          const preambleString = preamble.toString()
            .replace('openIDB()', `${openIDB.toString()}()`);

          // The argument to the preamble specifies the source files and
          // the the data structures to hold the counts, which is derived
          // from the structure of the coverage maps.
          const shapes = [...mapPathToIndex.keys()].map(path => {
            return [path, {
              s: opts.mapping.get(path)!.statementMap.length,
              f: opts.mapping.get(path)!.fnMap.length,
              b: opts.mapping.get(path)!.branchMap.map(branch => branch.locations.length)
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
          if (!start.source || !end.source) {
            // This can happen if the statement is not in the original source,
            // such as an injected statement from a plugin. In that case, skip
            // instrumentation.
            return;
          }

          const statementMap = opts.mapping.get(start.source)!.statementMap;
          fileIndex = mapPathToIndex!.get(start.source)!;
          statementIndex = statementMap.length;
          statementMap.push({
            start: { line: start.line, column: start.column },
            end: { line: end.line, column: end.column }
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
        const callExpression = makeStmtInjection({
          fileIndex: t.numericLiteral(fileIndex),
          statementIndex: t.numericLiteral(statementIndex),
        });
        path.insertBefore(callExpression);
      },

      FunctionDeclaration(path: any, state: any) {
        registerFn(path);
      },

      FunctionExpression(path: any, state: any) {
        registerFn(path);
      },

      ObjectMethod(path: any, state: any) {
        registerFn(path);
      },
      
      ClassMethod(path: any, state: any) {
        registerFn(path);
      },

      ArrowFunctionExpression(path: any, state: any) {
        registerFn(path);
      },

      IfStatement(path: any, state: any) {
        const childPaths = [path.get('consequent')];
        const alternatePath = path.get('alternate');
        if (alternatePath?.node && !alternatePath.isIfStatement()) {
          childPaths.push(alternatePath);
        }
        registerBranch(path, 'if', childPaths);
      },

      SwitchStatement(path: any, state: any) {
        const childPaths = path.get('cases')
          .map((p: any) => p.get('consequent.0'))
          .filter((p: any) => p?.node);
        registerBranch(path, 'switch', childPaths);
        debugger;
      },

      LogicalExpression(path: any, state: any) {
        const childPaths = [path.get('right')];
        registerBranch(path, 'binary-expr', childPaths);
      },

      ConditionalExpression(path: any, state: any) {
        const childPaths = [path.get('consequent'), path.get('alternate')];
        registerBranch(path, 'cond-expr', childPaths);
      },

      AssignmentPattern(path: any, state: any) {
        const childPaths = [path.get('right')];
        registerBranch(path, 'default-arg', childPaths);
      }
    }
  }
}
