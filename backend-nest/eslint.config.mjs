import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import { LEGACY_OVERSIZED } from "./eslint.legacy.mjs";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-case-declarations": "off",
      "no-useless-assignment": "off",
      "prefer-const": "off",
    },
  },

  // Factory gate (Phase 1): functions and files small enough to review and to hand to an agent.
  {
    files: ["src/**/*.ts"],
    rules: {
      complexity: ["error", 15],
      "max-lines": ["error", { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  // Tests may run long.
  {
    files: ["**/*.spec.ts", "test/**/*.ts"],
    rules: { "max-lines": "off" },
  },
  // Over the limits before the gate existed. The list only shrinks (see the file).
  {
    files: LEGACY_OVERSIZED,
    rules: { complexity: "off", "max-lines": "off" },
  },

  // Factory boundary (Phase 0): the gateway owns its code; other packages are reached over HTTP.
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/frontend/**", "**/backend/**", "**/cli/**"],
              message: "backend-nest never imports another package's code. Call the Django service over HTTP.",
            },
          ],
        },
      ],
    },
  },

  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "scripts/**"],
  }
);
