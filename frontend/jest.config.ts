import type { Config } from "jest";
import nextJest from "next/jest.js";
const createJestConfig = nextJest({ dir: "./" });
const config: Config = {
  coverageProvider: "v8",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^lucide-react(.*)$": "<rootDir>/src/__mocks__/lucide-react.js"
  },
  transformIgnorePatterns: [
    "/node_modules/(?!(lucide-react|@lucide)/)"
  ],
  testMatch: ["**/*.test.ts", "**/*.test.tsx"],
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/", "<rootDir>/dist/", "<rootDir>/out/", "<rootDir>/dist-electron/", "<rootDir>/tests/e2e/"]
};
export default createJestConfig(config);
