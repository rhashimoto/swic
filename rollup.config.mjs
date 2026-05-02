import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default [{
  input: 'src/swic.ts',
  output: {
    file: 'dist/swic.js',
    format: 'esm',
    sourcemap: true,
    sourcemapExcludeSources: true,
  },
  plugins: [
    nodeResolve(), 
    typescript()
  ],
  treeshake: false,
}];