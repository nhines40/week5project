module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  globalSetup: '<rootDir>/test-helpers/globalSetup.js',
  globalTeardown: '<rootDir>/test-helpers/globalTeardown.js',
  clearMocks: true,
  testTimeout: 20000,               // 20 seconds – plenty for DB start‑up
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  collectCoverageFrom: ['**/*.js', '!**/node_modules/**', '!**/test-helpers/**'],
};
