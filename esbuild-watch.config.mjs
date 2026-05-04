import { build, context } from "esbuild";
import { buildOptions } from "./esbuild.config.mjs";

(async function() {
  const options = Object.assign({}, buildOptions, {
    logLevel: "warning",
    plugins: [
      ...(buildOptions.plugins ?? []),
      {
        name: 'timestamp',
        setup(build) {
          build.onEnd(result => {
            const timestamp = new Date().toLocaleTimeString();
            let color = '\x1b[32m'; // green
            if (result.errors.length > 0) {
              color = '\x1b[31m'; // red
            } else if (result.warnings.length > 0) {
              color = '\x1b[33m'; // yellow
            }
            console.log(`${color}[${timestamp}] Build finished\x1b[0m`);
          });
        }
      }
    ]
  });

  const ctx = await context(options);
  await ctx.watch();
})();
