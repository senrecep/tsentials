import { configDefaults, defineConfig } from 'vitest/config';

const FULL_COVERAGE = { statements: 100, branches: 100, functions: 100, lines: 100 };

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, 'examples/**'],
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'test-report.junit.xml',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'cobertura'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      thresholds: {
        'src/validation/**': FULL_COVERAGE,
        'src/resilience/**': FULL_COVERAGE,
        'src/pagination/**': FULL_COVERAGE,
        'src/enums/**': FULL_COVERAGE,
        'src/mediator/**': FULL_COVERAGE,
        'src/idempotency/**': FULL_COVERAGE,
        'src/time/extensions.ts': FULL_COVERAGE,
      },
    },
  },
  resolve: {
    alias: {
      '~': new URL('./src', import.meta.url).pathname,
    },
  },
});
