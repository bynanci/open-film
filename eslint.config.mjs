import js from "@eslint/js";
import ts from "typescript-eslint";
import vue from "eslint-plugin-vue";
import vueParser from "vue-eslint-parser";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default ts.config(
  {
    ignores: [
      "**/dist/**",
      "**/target/**",
      "**/node_modules/**",
      "coverage/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...vue.configs["flat/recommended"],
  {
    files: ["**/*.{js,mjs,ts,vue}"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "vue/multi-word-component-names": "off",
    },
  },
  {
    files: ["**/*.vue"],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: ts.parser, extraFileExtensions: [".vue"] },
    },
  },
  { files: ["**/*.{ts,vue}"], rules: { "no-undef": "off" } },
  prettier,
);
