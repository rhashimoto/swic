import { build } from "esbuild";

build({
	entryPoints: ["src/swic.ts", "src/swic-support.ts"],
	bundle: true,
	format: "esm",
	outdir: "dist",
	sourcemap: true,
	platform: "browser",
	target: "es2022",
}).catch((error) => {
	console.error(error);
	process.exit(1);
});
