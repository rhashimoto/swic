import { transpile } from "../src/transpile";

describe("transpile", () => {
  it("should transpile", async () => {
    const source = `
      console.log('Hello, world!');
    `;

    const transpiled = await transpile(new URL('file:///foo.js'), source);
    expect(transpiled).toBeDefined();
  });
});