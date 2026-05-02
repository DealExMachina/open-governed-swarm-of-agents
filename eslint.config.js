import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "dist/",
      "build/",
      "node_modules/",
      "coverage/",
      "sgrs-core/target/",
      "pnpm-lock.yaml",
      ".git/",
    ],
  },
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-console": [
        "warn",
        {
          allow: ["error", "warn"],
        },
      ],
      "prefer-const": "warn",
      "no-var": "error",
      eqeqeq: ["warn", "always"],
    },
  },
];
