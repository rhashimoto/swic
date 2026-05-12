# Service Worker Instrumented Coverage (SWIC)
SWIC is a web developer utility to collect code coverage data by
instrumenting Javascript in a service worker. Data is accumulated
to IndexedDB and can be exported to a file in Istanbul format to
be analyzed by tools like [nyc](https://github.com/istanbuljs/nyc).

The main reason SWIC exists is there do not seem to be coverage
tools for browser Workers. In addition, it requires very little
effort to start playing with it so that may be useful in other
scenarios. However, it was built for interactive use and is
not suitable as-is for automated application like CI/CD.

## Quick Start
These instructions will work if the contexts (Windows, Workers, etc.)
you use do not terminate by themselves.

* Copy (or symlink) the files `dist/swic.html` and `dist/swic.js`
into your project tree. They must be at or above the directories
that contain the web pages that exercise your software.
* Connect a web browser to your development web server and bring
up the `swic.html` admin page, then:
  * Turn Coverage Instrumentation on.
  * Enter your list of source file patterns and click Update Patterns.
* In another tab or tabs, exercise your software.
* Back on `swic.html`:
  * Click the Collect button to signal all contexts to save their data.
  * Click on the Export button to download an Istanbul-compatible file.

You can then use common coverage tools to analyze and visualize the
data. For example, if the downloaded file is saved to `.nyc_output/coverage.json`,
then `nyc report` can be used.

## Configuring Patterns
The source file patterns on `swic.html` tell SWIC how to identify the
files you want coverage data for. Each pattern is a "glob" expression
as supported by [minimatch](https://github.com/isaacs/minimatch).

Glob expressions may be inclusive or exclusive (exclusive globs start
with "!"). A file will be instrumented if its path matches any inclusive
expression and no exclusive expressions. Note that the order the patterns
are specified does not matter.

## Ephemeral Contexts
Contexts that exit by themselves may not be easily handled by the `swic.html`
Collect button. Collecting data (which moves it from memory into persistent
IndexedDB storage) must happen after the code is executed but before the
context exits. In these cases it may be necessary to trigger collection
programmatically.

Programmatic collection can be done either by dispatching a "swic-save"
event on the context:

```javascript
const detail = { response: null };
globalThis.dispatchEvent(new CustomEvent('swic-save', { detail }));
await detail.response;
```

or by sending any message on the "swic-save"
BroadcastChannel:

```javascript
new BroadcastChannel('swic-save').postMessage(null);
```