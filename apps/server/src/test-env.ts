import type { MediaTools } from './media/tools.ts';

/**
 * What a CI run of the server suite lacks (#855). Locally the suites that need a database, Valkey
 * or the media tools skip; in CI a missing one would turn them into green skips, so it fails.
 * `INKADRA_TEST_MEDIA_TOOLS=required` marks the runs that install the media tools.
 */
export function missingTestEnv(env: NodeJS.ProcessEnv, tools: Partial<MediaTools>): string[] {
  if (!env.CI) return [];
  const missing = ['DATABASE_URL', 'REDIS_URL'].filter((name) => !env[name]);
  if (env.INKADRA_TEST_MEDIA_TOOLS === 'required') {
    for (const tool of ['ffmpeg', 'ffprobe', 'exiftool', 'pdftoppm', 'pdfinfo'] as const) {
      if (!tools[tool]) missing.push(tool);
    }
  }
  return missing;
}
