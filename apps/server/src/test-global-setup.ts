import { mediaTools } from './media/tools.ts';
import { missingTestEnv } from './test-env.ts';

export default async function checkTestEnv() {
  const missing = missingTestEnv(process.env, await mediaTools());
  if (missing.length) {
    throw new Error(
      `CI must not skip the server suites: missing ${missing.join(', ')}. Set them in .github/workflows/ci.yml.`,
    );
  }
}
