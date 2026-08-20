import type { Config } from "jest";
import nextJest from "next/jest.js";

// next/jest is Next's own Jest integration: it wires up the SWC transform,
// the tsconfig path aliases (so "@/lib/api" resolves in tests exactly as it
// does in the app), CSS/asset stubs, and .env loading. Hand-rolling those
// would drift from whatever the Next version does.
//
// Jest rather than Vitest deliberately: apps/api already standardises on
// Jest 30, and a monorepo with two test frameworks means two configs, two
// mental models and two CI paths for no gain here.
const createJestConfig = nextJest({ dir: "./" });

const config: Config = {
  testEnvironment: "jsdom",
  // .next/standalone contains a copy of package.json, which Jest's module
  // map otherwise flags as a duplicate of the real one.
  modulePathIgnorePatterns: ["<rootDir>/.next/"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  // Mirrors apps/api's convention: colocated *.spec.ts(x) beside the source.
  testMatch: ["<rootDir>/app/**/*.spec.{ts,tsx}"],
  collectCoverageFrom: ["app/**/*.{ts,tsx}", "!app/**/*.spec.{ts,tsx}", "!app/**/layout.tsx"],
  coverageDirectory: "../coverage-web",
};

export default createJestConfig(config);
