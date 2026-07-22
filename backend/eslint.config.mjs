import { fileURLToPath } from "node:url";
import path from "node:path";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-config-prettier";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: __dirname,
        sourceType: "module"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs["recommended-type-checked"].rules,
      ...prettier.rules,
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-namespace": "off",
      // Adapter/store ports are async by contract; many Fake/in-memory impls are sync.
      "@typescript-eslint/require-await": "off",
      // IG JSON bodies arrive as Record<string, unknown> — String() is intentional.
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off"
    }
  }
];
