/**
 * Test layers for the `evm` CLI.
 *
 * Four projects, split by what they are allowed to touch:
 *
 *   unit             pure functions, no I/O of any kind
 *   integration      real temp filesystem and loopback HTTP servers, in process
 *   acceptance       the compiled dist/index.js, spawned as a child process
 *   characterization the pre-existing golden-master suite, also against dist
 *
 * Every option is stated rather than inherited from a Vitest default, because
 * pool, environment and include globs have all changed across majors.
 *
 * Coverage is collected from the in-process layers only: the v8 provider
 * instruments the worker, and a spawned CLI runs outside it. The acceptance and
 * characterization layers are behavioural gates rather than coverage
 * contributors, so `src/cli/**` and the command handlers earn their coverage
 * from integration tests that drive the same Commander tree in process.
 */

import { defineConfig } from 'vitest/config';

const shared = {
  environment: 'node',
  globals: false,
  // Each test builds its own environment and temp tree; forks keep a leaked
  // process.env or cwd from reaching the next file.
  pool: 'forks',
  isolate: true,
  restoreMocks: true,
  unstubEnvs: true,
  unstubGlobals: true,
} as const;

/**
 * Layers that spawn the CLI wait on real sockets and on the CLI's own 5s and
 * 60s timeouts, so they cannot live with the 5s default.
 */
const childProcess = {
  testTimeout: 90_000,
  hookTimeout: 30_000,
  globalSetup: ['test/setup/build-cli.ts'],
};

const inProcess = {
  testTimeout: 15_000,
  hookTimeout: 15_000,
  setupFiles: ['test/setup/offline.ts'],
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          ...inProcess,
          name: { label: 'unit', color: 'green' },
          include: ['test/unit/**/*.test.ts'],
          testTimeout: 5_000,
        },
      },
      {
        test: {
          ...shared,
          ...inProcess,
          name: { label: 'integration', color: 'cyan' },
          include: ['test/integration/**/*.test.ts'],
        },
      },
      {
        test: {
          ...shared,
          ...childProcess,
          name: { label: 'acceptance', color: 'magenta' },
          include: ['test/acceptance/**/*.test.ts'],
        },
      },
      {
        test: {
          ...shared,
          ...childProcess,
          name: { label: 'characterization', color: 'yellow' },
          include: ['test/characterization/**/*.test.ts'],
        },
      },
    ],

    coverage: {
      provider: 'v8',
      enabled: false,
      // Explicit: the default counts only files a test imported, which would
      // hide a module nothing reaches.
      include: ['src/**/*.ts'],
      exclude: [
        // Interfaces only — nothing to execute.
        'src/types.ts',
        'src/lib/explorer/types.ts',
        'src/lib/prices/types.ts',
      ],
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      // A floor a few points under what the suite reaches, so a regression
      // fails the build and a refactor does not. Raising these to force a
      // number would buy assertion-free tests; read the HTML report for
      // uncovered *branches* instead, which is where the error paths are.
      thresholds: {
        lines: 83,
        statements: 83,
        functions: 92,
        branches: 74,
        // Every command depends on these, so they are held higher.
        'src/lib/**': { lines: 88, statements: 88, functions: 92, branches: 82 },
      },
    },
  },
});
