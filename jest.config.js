module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'index.ts',
    'lib/**/*.ts',
    '!lib/**/*.d.ts'
  ],
  testMatch: [
    '**/test/**/*.test.ts'
  ],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  coverageThreshold: {
    // Per-file thresholds for files with dedicated unit/integration coverage.
    './index.ts': {
      lines: 45,
      functions: 30,
      branches: 30,
      statements: 45
    },
    './lib/node-onvif.ts': {
      lines: 70,
      functions: 45,
      branches: 50,
      statements: 70
    },
    './lib/modules/device.ts': {
      lines: 28,
      functions: 17,
      branches: 12,
      statements: 28
    },
    './lib/modules/http-auth.ts': {
      lines: 90,
      functions: 95,
      branches: 70,
      statements: 90
    },
    './lib/modules/service-device.ts': {
      lines: 8,
      functions: 1,
      branches: 8,
      statements: 8
    },
    './lib/modules/service-events.ts': {
      lines: 44,
      functions: 24,
      branches: 29,
      statements: 44
    },
    './lib/modules/service-media.ts': {
      lines: 9,
      functions: 2,
      branches: 3,
      statements: 9
    },
    './lib/modules/service-ptz.ts': {
      lines: 13,
      functions: 5,
      branches: 6,
      statements: 13
    },
    './lib/modules/soap.ts': {
      lines: 28,
      functions: 30,
      branches: 7,
      statements: 28
    },
    './lib/utils/validation.ts': {
      lines: 85,
      functions: 85,
      branches: 80,
      statements: 85
    }
  }
};
