import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Intentional patterns in this codebase, kept visible as warnings:
      // - forms initialise local state from query data once it arrives
      // - animation/autosave hooks keep the latest value in a ref for rAF/timer callbacks
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "data/**", "public/sw.js", "playwright-report/**", "test-results/**", "video/**"]),
]);

export default eslintConfig;
