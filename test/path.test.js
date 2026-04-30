import { buildPathMatcher } from "../src/path";

describe("pathMatcher", () => {
  const matcher = buildPathMatcher([
    "/src/*.js",
    "/src/*.ts",
    "/**/foo.bar",
    "!tmp.js",
    "!/**/node_modules/**",
  ]);

  it("should match positive patterns", () => {
    expect(matcher("/src/app.js")).toBe(true);
    expect(matcher("/src/utils.js")).toBe(true);
  });

  it("should not match negative patterns", () => {
    expect(matcher("/src/tmp.js")).toBe(false);
    expect(matcher("/src/node_modules/foo.bar")).toBe(false);
  });

  it("should not match non-matching patterns", () => {
    expect(matcher("style.css")).toBe(false);
    expect(matcher("index.html")).toBe(false);
  });
});