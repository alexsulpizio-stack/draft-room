import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // These React 19 compiler-oriented rules are valuable during refactors, but
  // this app intentionally uses refs as mutable coordination handles around an
  // external localStorage-backed store and initializes some browser-only state
  // from effects. Treat them as warnings so lint still catches real errors
  // without blocking the build on established behavior.
  {
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Regression scripts are executable Node test harnesses. A few intentionally
  // use require() to clear module caches and reload modules during sentinel
  // checks, so allow CommonJS imports there only.
  {
    files: ["scripts/**/*.{ts,tsx,js,mjs,cjs}"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
