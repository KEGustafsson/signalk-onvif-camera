module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'index.ts',
    'lib/**/*.ts',
    '!lib/node-onvif.ts'
  ],
  testMatch: [
    '**/test/**/*.test.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  coverageThreshold: {
    // Per-file thresholds for files that have real unit test coverage.
    // lib/modules/*.js files require real ONVIF hardware and cannot be
    // meaningfully unit tested, so no threshold is set for them.
    './index.ts': {
      lines: 45,
      functions: 30,
      branches: 30,
      statements: 45
    },
    './lib/utils/validation.ts': {
      lines: 85,
      functions: 85,
      branches: 80,
      statements: 85
    }
  }
};
