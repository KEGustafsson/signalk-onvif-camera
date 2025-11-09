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
  verbose: true
};
