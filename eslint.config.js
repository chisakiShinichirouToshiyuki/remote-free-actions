import {
    defineConfig,
    globalIgnores
} from "eslint/config";

import globals from "globals";

import {
    fixupConfigRules,
} from "@eslint/compat";

import tsParser from "@typescript-eslint/parser";
import reactRefresh from "eslint-plugin-react-refresh";
import security from "eslint-plugin-security";
import js from "@eslint/js";

import {
    FlatCompat,
} from "@eslint/eslintrc";

const compat = new FlatCompat({
    baseDirectory: import.meta.dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([{
    languageOptions: {
        globals: {
            ...globals.browser,
        },

        parser: tsParser,
    },

    extends: fixupConfigRules(compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:react-hooks/recommended",
    )),

    plugins: {
        "react-refresh": reactRefresh,
    },

    rules: {
        "react-refresh/only-export-components": ["warn", {
            allowConstantExport: true,
        }],

        // Security hardening (public repo, auth/token surface).
        // Dynamic code execution: never acceptable in this codebase.
        "no-eval": "error",
        "no-implied-eval": "error",
        "no-new-func": "error",
        // React XSS sink: the app renders no rich text; any use is a bug.
        "no-restricted-syntax": [
            "error",
            {
                selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
                message: "XSS sink: this app must not render raw HTML.",
            },
        ],
        // Timing-unsafe string comparison of secrets slips through reviews;
        // secrets in this repo are compared only inside vetted libs (JWT verify).
        "security/detect-possible-timing-attacks": "error",
    },
}, security.configs.recommended, {
    // Node CLI utilities (deploy/bootstrap), not part of the browser bundle.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
        globals: {
            ...globals.node,
        },
    },
    rules: {
        // Reading a user-supplied outputs path is the whole point of the tool.
        "security/detect-non-literal-fs-filename": "off",
    },
}, globalIgnores(["**/dist", ".amplify", "amplify_outputs.json"])]);
