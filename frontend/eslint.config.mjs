import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { LEGACY_OVERSIZED } from "./eslint.legacy.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Factory gate (Phase 1): functions and files small enough to review and to hand to an agent.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      complexity: ["error", 15],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  // Tests may run long.
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/__tests__/**"],
    rules: { "max-lines": "off" },
  },
  // Over the limits before the gate existed. The list only shrinks (see the file).
  {
    files: LEGACY_OVERSIZED,
    rules: { complexity: "off", "max-lines": "off" },
  },

  // Factory boundary (Phase 0): the browser reaches data only through the NestJS gateway (/api/...).
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: ["@prisma/client", "pg", "postgres", "redis", "ioredis"].map((name) => ({
            name,
            message: "The frontend never talks to a database. Call the NestJS gateway through src/lib/api.ts.",
          })),
          patterns: [
            {
              group: ["**/backend/**", "**/backend-nest/**", "**/cli/**"],
              message: "The frontend never imports another package's code. Go through the NestJS gateway.",
            },
          ],
        },
      ],
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
