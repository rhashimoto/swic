import "@babel/standalone";
import { babelPlugin } from "../src/transpile";

// @ts-ignore
const Babel = /** @type {typeof import("@babel/standalone")} */(globalThis.Babel);

describe("babelPlugin", () => {
  it("should import Babel correctly", () => {
    const source = `
      console.log('Hello, world!');
    `;

    /** @type {import("../src/transpile").CustomPluginOptions} */
    const pluginOptions = {
      sourceMap: undefined
    };

    const transpiled = Babel.transform(source, {
      parserOpts: {
        strictMode: true,
        allowAwaitOutsideFunction: true,
        sourceFilename: '/foo.js', // used for AST node location
      },
      inputSourceMap: undefined,
      sourceMaps: 'inline',
      filename: '/foo.js', // used for error messages and state
      plugins: [[babelPlugin, pluginOptions]]
    });
    expect(transpiled.code).toBeDefined();
  });
});