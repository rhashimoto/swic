import { build } from "esbuild";

export const buildOptions = {
	entryPoints: ["src/swic.ts"],
  inject: ["@babel/standalone"],
	bundle: true,
	format: "esm",
	outdir: "dist",
	sourcemap: true,
  sourcesContent: false,
	platform: "browser",
	target: "es2022",
  logLevel: "info",
};

build(buildOptions).catch((error) => {
	console.error(error);
	process.exit(1);
});
