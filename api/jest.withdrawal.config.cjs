module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: 'execution/withdrawal(-stocks)?\\.real\\.test\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  moduleNameMapper: { '^uuid$': '<rootDir>/test/uuid.mock.ts' },
};
