import eslint from "@eslint/js";
import boundaries from "eslint-plugin-boundaries";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const typescriptFiles = ["**/*.ts", "**/*.tsx"];

export default tseslint.config(
  {
    ignores: [
      "**/coverage/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "**/*.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: typescriptFiles,
  })),
  {
    files: typescriptFiles,
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        {
          type: "web",
          pattern: "apps/web/src/**",
        },
        {
          type: "host",
          pattern: "apps/{api,worker}/src/**",
        },
        {
          type: "contracts",
          pattern: "packages/contracts/src/**",
        },
        {
          type: "module",
          pattern: "packages/modules/*/src/**",
          capture: ["module"],
        },
        {
          type: "platform",
          pattern: "packages/platform/*/src/**",
          capture: ["platform"],
        },
        {
          type: "testkit",
          pattern: "packages/testkit/src/**",
        },
      ],
      "boundaries/legacy-templates": false,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
        },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: { element: { type: "web" } },
              allow: { to: { element: { type: "contracts" } } },
            },
            {
              from: { element: { type: "host" } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ["contracts", "module", "platform"] },
                  },
                },
              },
            },
            {
              from: { element: { type: "module" } },
              allow: {
                to: {
                  element: [
                    { type: "contracts" },
                    {
                      type: "module",
                      captured: {
                        module: "{{ from.element.captured.module }}",
                      },
                    },
                  ],
                },
              },
            },
            {
              from: { element: { type: "platform" } },
              allow: {
                to: {
                  element: [
                    { type: "contracts" },
                    { type: "module" },
                    {
                      type: "platform",
                      captured: {
                        platform: "{{ from.element.captured.platform }}",
                      },
                    },
                  ],
                },
              },
            },
            {
              from: { element: { type: "testkit" } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ["contracts", "module", "platform"] },
                  },
                },
              },
            },
          ],
        },
      ],
      eqeqeq: ["error", "always"],
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}", "**/test/**"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
);
