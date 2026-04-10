module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/integration/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/tests/integration/helpers/jest.cleanup.js"],
  maxWorkers: 1,
  testTimeout: 120000,
  verbose: true,
};
