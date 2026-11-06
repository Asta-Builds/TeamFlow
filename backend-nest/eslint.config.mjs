import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

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
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "scripts/**"],
  }
);
