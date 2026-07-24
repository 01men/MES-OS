import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    // SWC required: NestJS DI relies on emitDecoratorMetadata, esbuild does not emit it
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
