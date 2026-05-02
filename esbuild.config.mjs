import { build } from "esbuild";

export const buildOptions = {
	entryPoints: ["src/swic.ts", "src/swic-support.ts"],
	bundle: true,
	format: "esm",
	outdir: "dist",
	sourcemap: true,
  sourcesContent: false,
  treeShaking: false,
	platform: "browser",
	target: "es2022",
  logLevel: "info",
};

build(buildOptions).catch((error) => {
	console.error(error);
	process.exit(1);
});
