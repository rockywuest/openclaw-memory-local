const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    rules: {
      semi: ["error", "always"],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    ignores: ["node_modules/", "test/"],
  },
];
