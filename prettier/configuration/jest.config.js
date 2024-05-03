module.exports = {
  setupFiles: ["./configuration/run_spec.js"],
  snapshotSerializers: ["./configuration/raw-serializer.js"],
  testEnvironment: "node",
  testRegex: "run_tests.js$",
  rootDir: "..",
  transform: {},
  watchPlugins: [
    "jest-watch-typeahead/filename",
    "jest-watch-typeahead/testname",
  ],
};
