import * as Comlink from 'comlink';
import { transpile } from "../src/transpile";

describe("transpile", () => {
  /** @type {any} */ let proxy;
  beforeEach(() => {
    const worker = new Worker(new URL('./eval-worker.js', import.meta.url), { type: 'module' });
    proxy = Comlink.wrap(worker);
  });

  afterEach(async () => {
    proxy('globalThis.close()');
    proxy[Comlink.releaseProxy]();
  });

  it("should transpile", async () => {
    const source = `
      console.log('Hello, world!');
    `;

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    expect(typeof transpiled).toBe('object');
    expect(typeof transpiled.code).toBe('string');
    expect(transpiled.mapping instanceof Map).toBe(true);
  });

  it("should produce executable code", async () => {
    const source = `6 * 7;`;

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    const result = await proxy(transpiled.code);
    expect(result).toBe(42);
  });

  it("should create counters", async () => {
    const source = `6 * 7;`;

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);
    
    const { counters } = await proxy('globalThis.__swic__');
    expect(counters).toEqual(new Map([
      ['/foo.js', { s: [1], f: [], b: [] }],
    ]));
  });

  it("should count statements", async () => {
    const source = `
      let foo = 0;
      for (let i = 0; i < 3; i++) {
        foo += i;
      }
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);
    
    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').s).toEqual([1, 1, 3]);
  });

  it("should count declared functions", async () => {
    const source = `
      function foo(x) { return x + 1;}
      foo(1);
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').f).toEqual([1]);
  });

  it("should count anonymous functions", async () => {
    const source = `
      const foo = function(x) { return x + 1; }
      foo(1);
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').f).toEqual([1]);
  });

  it("should count arrow functions", async () => {
    const source = `
      const foo = (x) => { return x + 1; };
      const bar = (x) => x * x;
      foo(1);
      bar();
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').f).toEqual([1, 1]);
  });

  it("should count methods", async () => {
    const source = `
      class Foo {
        method(x) { return x + 1; }
      }
      const foo = new Foo();
      foo.method(1);
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').f).toEqual([1]);
  });

  it("should count static class methods", async () => {
    const source = `
      class Foo {
        static method(x) { return x + 1; }
      }
      Foo.method(1);
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').f).toEqual([1]);
  });

  it("should count simple if branch", async () => {
    const source = `
      let foo = 0;
      if (true) {
        foo = 42;
      }
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1]]);
  });

  it("should count if-else consequent branch", async () => {
    const source = `
      let foo = 0;
      if (true) {
        foo = 42;
      } else {
        foo = -1;
      }
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1, 0]]);
  });

  it("should count if-else alternate branch", async () => {
    const source = `
      let foo = 0;
      if (false) {
        foo = 42;
      } else {
        foo = -1;
      }
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[0, 1]]);
  });

  it("should count ternary consequent branch", async () => {
    const source = `
      let foo = 0;
      foo = true ? 42 : -1;
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1, 0]]);
  });

  it("should count ternary alternate branch", async () => {
    const source = `
      let foo = 0;
      foo = false ? 42 : -1;
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[0, 1]]);
  });

  it("should count logical AND short-circuit branch", async () => {
    const source = `
      let foo = false && 42;
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[0]]);
  });

  it("should count logical AND evaluated branch", async () => {
    const source = `
      let foo = true && 42;
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1]]);
  });

  it("should count logical OR short-circuit branch", async () => {
    const source = `
      let foo = true || -1;
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[0]]);
  });

  it("should count logical OR evaluated branch", async () => {
    const source = `
      let foo = false || -1;
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1]]);
  });

  it("should count switch case branches", async () => {
    const source = `
      let foo = 0;
      switch (1) {
        case 1:
          foo = 42;
          break;
        case 2:
          break;
        default:
          foo = -2;
      }
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1, 0, 0]]);
  });

  it("should count switch default case branch", async () => {
    const source = `
      let foo = 0;
      switch (3) {
        case 1:
          break;
        case 2:
          break;
        default:
          foo = -2;
      }
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[0, 0, 1]]);
  });

  it("should count switch fallthrough branches", async () => {
    const source = `
      let foo = 0;
      switch (1) {
        case 1:
        case 2:
          foo += 2;
          break;
        default:
          foo += 4;
      }
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1, 0]]);
  });

  it("should count default parameter used branches", async () => {
    const source = `
      function foo(x = 42) {
        return x;
      }
      foo();
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[1]]);
  });

  it("should count default parameter unused branches", async () => {
    const source = `
      function foo(x = 42) {
        return x;
      }
      foo(0);
    `.trim();

    const transpiled = await transpile(new URL('/foo.js', import.meta.url), source);
    await proxy(transpiled.code);

    const { counters } = await proxy('globalThis.__swic__');
    expect(counters.get('/foo.js').b).toEqual([[0]]);
  });
});