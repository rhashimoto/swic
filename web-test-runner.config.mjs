import { chromeLauncher } from '@web/test-runner';
import { esbuildPlugin } from '@web/dev-server-esbuild';
import { jasmineTestRunnerConfig } from 'web-test-runner-jasmine';

export default /** @type {import("@web/test-runner").TestRunnerConfig} */ ({
  ...jasmineTestRunnerConfig(),
  testFramework: {
    config: {
      defaultTimeoutInterval: 5 * 60 * 1000
    },
  },
  browserLogs: true,
  filterBrowserLogs: ({ type, args }) => {
    if (type === 'error' &&
        args[0]?.includes("DEPRECATION: jasmine-core isn't an ES module")) {
      return false;
    }

    return !['trace', 'debug'].includes(type);
  },
  browserStartTimeout: 60_000,
  nodeResolve: true,
  files: ['./test/*.test.js'],
  plugins: [esbuildPlugin({ ts: true })],
  concurrency: 1,
  concurrentBrowsers: 1,
  browsers: [
    chromeLauncher({
      launchOptions: {
      },
    }),
  ],
});