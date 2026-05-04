import { transpile } from "../src/transpile";

describe("transpile", () => {
  it("should transpile", async () => {
    const source = `
      console.log('Hello, world!');
    `;

    const encodedBody = new TextEncoder().encode(source);
    const transpiled = await transpile('/foo.js', encodedBody.buffer);
    expect(transpiled).toBeDefined();
  });
});