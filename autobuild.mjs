import chokidar from 'chokidar';
import { execSync } from 'node:child_process';

const watchOptions = {
  ignored: (file, _stats) => _stats?.isFile() && !file.endsWith('.ts'),
  // usePolling: true,
  // awaitWriteFinish: true,
};

function handler(path) {
  console.log(new Date().toLocaleTimeString(), path);
  try {
    execSync('yarn build', { stdio: 'inherit' });
  } catch (error) {
    // Ignore build errors to keep the watcher running.
  }
}
chokidar.watch('./src', watchOptions)
  .on('add', handler)
  .on('change', handler)
