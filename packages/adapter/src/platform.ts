export type Platform = 'node' | 'vercel' | 'netlify' | 'cloudflare' | 'deno' | 'aws' | 'edge' | 'coxmos';

const VALID: Platform[] = ['node', 'vercel', 'netlify', 'cloudflare', 'deno', 'aws', 'edge', 'coxmos'];

export interface PlatformEnv {
  [key: string]: string | undefined;
}

/**
 * Detect the deployment platform from the build environment so `vesk build`
 * emits the correct artifact (Vercel Build Output API, Netlify functions,
 * Cloudflare _worker.js, Deno entry, etc.) without extra flags.
 *
 * Precedence:
 *   1. Explicit `--platform <name>` CLI override
 *   2. Well-known platform environment variables set by CI/build systems
 *   3. Defaults to `node`
 */
export function detectPlatform(args: string[] = [], env: PlatformEnv = process.env as PlatformEnv): Platform {
  const flagIdx = args.indexOf('--platform');
  if (flagIdx !== -1) {
    const explicit = (args[flagIdx + 1] || '').toLowerCase();
    if ((VALID as string[]).includes(explicit)) return explicit as Platform;
  }

  if (env.VERCEL || env.VERCEL_ENV || env.NOW_REGION || env.VERCEL_GIT_COMMIT_SHA) return 'vercel';

  if (env.NETLIFY || env.NETLIFY_BUILD_CONTEXT || env.NETLIFY_LOCAL || env.NETLIFY_EDGE) return 'netlify';

  if (env.CF_PAGES || env.CF_PAGES_BRANCH || env.CF_PAGES_URL || env.CLOUDFLARE_WORKERS || env.WORKERS_NAME) return 'cloudflare';

  if (env.DENO_DEPLOYMENT_ID || env.DENO_REGION || env.DENO_DEPLOY_URL) return 'deno';

  if (env.AWS_LAMBDA_FUNCTION_NAME || env.AWS_LAMBDA_FUNCTION_VERSION || env.LAMBDA_TASK_ROOT || env.LAMBDA_RUNTIME_DIR) return 'aws';

  if (env.COXMOS || env.COXMOS_DEPLOYMENT_ID || env.COXMOS_ENV || env.VESK_DEPLOY || env.VESK_PLATFORM === 'coxmos') return 'coxmos';

  return 'node';
}

export function platformLabel(platform: Platform): string {
  return platform === 'node' ? 'node (default)' : platform;
}
