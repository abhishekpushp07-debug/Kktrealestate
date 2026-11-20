// Same rules as the build (craco.config.js eslint.configure) so `yarn lint` fails wherever `yarn build` would.
module.exports = {
  root: true,
  extends: ["react-app"],
  rules: {
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "error",
    "react/no-array-index-key": "error",
    "no-undef": "error",
    "react/jsx-no-undef": "error",
  },
  overrides: [
    { files: ["src/components/common/**"], rules: { complexity: ["error", 20] } },
    { files: ["src/pages/v2/**"], rules: { "no-nested-ternary": "warn" } },
  ],
};
