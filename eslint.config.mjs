import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const config = [
  ...coreWebVitals,
  ...typescript,
  {
    // `.claude/**` covers agent worktrees, which are untracked but sit inside
    // the project and can contain their own build output — eslint would
    // otherwise lint a Turbopack bundle and fail on generated code.
    ignores: ["**/.next/**", "node_modules/**", ".netlify/**", ".claude/**"],
  },
];

export default config;
