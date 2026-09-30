import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// Lints the code shipped in skills/*/assets (and the tests) with the React Hooks rules,
// including the React Compiler-derived rules in `recommended`, so the assets are safe to copy
// into compiled codebases.
export default tseslint.config(
  { ignores: ['node_modules/**', 'eval-workspace/**', 'evals/**'] },
  {
    files: ['skills/**/assets/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
);
