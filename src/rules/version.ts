/** Rules version stamped on every evaluation: the deployed git SHA, or "dev" locally. */
export const DEFAULT_RULES_VERSION: string =
  process.env.RULES_VERSION || process.env.VERCEL_GIT_COMMIT_SHA || 'dev';
