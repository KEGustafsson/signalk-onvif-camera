module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'index.js',
    'lib/**/*.js',
    '!lib/node-onvif.js'
  ],
  testMatch: [
    '**/test/**/*.test.js'
  ],
  verbose: true,
  coverageThreshold: {
    // Per-file thresholds for files that have real unit test coverage.
    // lib/modules/*.js files require real ONVIF hardware and cannot be
    // meaningfully unit tested, so no threshold is set for them.
    './index.js': {
      lines: 45,
      functions: 30,
      branches: 30,
      statements: 45
    },
    './lib/utils/validation.js': {
      lines: 85,
      functions: 85,
      branches: 80,
      statements: 85
    }
  }
};
