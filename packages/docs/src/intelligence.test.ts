import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VeskConfig } from '@vesk/types';
import { validateConfig } from '@vesk/compiler/src/config';
import { analyzeProject } from '@vesk/docs/src/analyzer';
import { buildIntelligenceArtifacts, formatDocsUrl, isIntelligenceEnabled, resolveDocsConfig } from '@vesk/docs/src/artifacts';
import { formatInspection, inspect } from '@vesk/docs/src/inspect';
import { generateDocsHtml } from '@vesk/docs/src/docs-html';
import { generateOpenApiJson } from '@vesk/docs/src/openapi';
import { generateOpenApiYaml } from '@vesk/docs/src/yaml';

const root = mkdirSync(join(tmpdir(), `vesk-docs-${Date.now()}-${Math.random()}`), { recursive: true });
const routeDir = join(root, 'app', 'api', 'users', '[id]');
mkdirSync(routeDir, { recursive: true });
writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'docs-fixture', version: '1.0.0' }, null, 2)}\n`);
writeFileSync(join(root, 'tsconfig.json'), `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    strict: true,
    skipLibCheck: true,
    noEmit: true,
  },
}, null, 2)}\n`);
writeFileSync(join(routeDir, 'route.ts'), `
interface RequestLike {
  json<T>(): Promise<T>;
  query: Record<string, string>;
  headers: { get(name: string): string | null };
  cookies?: { get(name: string): string | null };
  params: Record<string, string>;
}

interface ResponseBuilder {
  setStatus(status: number): ResponseBuilder;
  setCookie(name: string, value: string, options: Record<string, unknown>): ResponseBuilder;
}

declare const VeskResponse: { json<T>(value: T): ResponseBuilder };

export interface CreateUser {
  name: string;
  email?: string;
}

export interface User {
  id: string;
  name: string;
  email?: string;
}

/**
 * @summary Create a user
 * @description Creates a typed user from a JSON body.
 * @security bearerAuth
 */
export async function POST(req: RequestLike) {
  const body = await req.json<CreateUser>();
  const verbose = req.query.verbose;
  const auth = req.headers.get('authorization');
  const user = { id: '1', name: body.name } as User;
  return VeskResponse.json<User>(user).setStatus(201).setCookie('session', 'super-secret', { httpOnly: true });
}

export async function GET(req: RequestLike) {
  const id = Number(req.params.id);
  const token = req.headers.get('authorization');
  const session = req.cookies?.get('session');
  const users = [{ id: String(id), name: 'Ada' }] as User[];
  return VeskResponse.json<User[]>(users);
}
`);
const sessionDir = join(root, 'app', 'api', 'session');
mkdirSync(sessionDir, { recursive: true });
writeFileSync(join(sessionDir, 'middleware.ts'), `
interface ContextLike {
  cookies?: { get(name: string): string | null };
  set(name: string, value: unknown): void;
}

type Next = () => unknown;

export async function middleware(ctx: ContextLike, next: Next) {
  const session = ctx.cookies?.get('session');
  if (session) ctx.set('user', { id: '1' });
  return next();
}
`);
writeFileSync(join(sessionDir, 'route.ts'), `
interface SessionRequest {
  locals?: { user?: { id: string } | null };
}

declare const VeskResponse: { json<T>(value: T): unknown };

/** @status 202 */
export async function GET(req: SessionRequest) {
  return VeskResponse.json({ user: req.locals?.user ?? null });
}

/** @public */
export async function POST() {
  return VeskResponse.json({ ok: true });
}
`);
writeFileSync(join(root, 'app', 'middleware.ts'), `
interface ContextLike {
  cookies?: { get(name: string): string | null };
  header(name: string, value: string): void;
}

type Next = () => unknown;

export async function middleware(ctx: ContextLike, next: Next) {
  const session = ctx.cookies?.get('session');
  if (session) ctx.header('x-session-seen', session);
  return next();
}
`);
const statusDir = join(root, 'app', 'api', 'status');
mkdirSync(statusDir, { recursive: true });
writeFileSync(join(statusDir, 'route.ts'), `
declare function notFound(): never;
declare function permanentRedirect(url: string): never;

declare const VeskResponse: {
  json<T>(value: T): unknown;
  redirect(url: string, status?: number): unknown;
};

/** @public */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get('missing') === '1') notFound();
  if (url.searchParams.get('moved') === '1') return Response.redirect('https://example.com/', 301);
  if (url.searchParams.get('gone') === '1') permanentRedirect('https://example.com/');
  if (url.searchParams.get('vesk') === '1') return VeskResponse.redirect('/target');
  return VeskResponse.json({ ok: true });
}
`);
const pageDir = join(root, 'app', 'dashboard');
mkdirSync(pageDir, { recursive: true });
writeFileSync(join(pageDir, 'page.tsx'), `export async function GET() {
  return new Response('dashboard');
}

export default function Page() {
  return <main>Dashboard</main>;
}
`);

const intelligence = analyzeProject({ projectRoot: root, appDir: join(root, 'app'), disableCache: true });
const cached = analyzeProject({ projectRoot: root, appDir: join(root, 'app'), cacheDir: '.test-intelligence-cache' });
assert.equal(cached.routes.length, 3);
assert.ok(existsSync(join(root, '.test-intelligence-cache', 'analysis.json')));
assert.equal(intelligence.routes.length, 3);
assert.ok(intelligence.routes.every((item) => item.sourceFile.includes('/api/')));
assert.ok(!intelligence.routes.some((item) => item.path.includes('dashboard')));
assert.ok(intelligence.securitySchemes.some((scheme) => scheme.id === 'bearerAuth'));
assert.ok(intelligence.securitySchemes.some((scheme) => scheme.id === 'sessionCookie'));
const sessionRoute = intelligence.routes.find((item) => item.path === '/session');
assert.ok(sessionRoute, 'expected /session route');
const sessionGet = sessionRoute.operations.find((operation) => operation.method === 'GET');
const sessionPost = sessionRoute.operations.find((operation) => operation.method === 'POST');
assert.ok(sessionGet, 'expected GET /session operation');
assert.ok(sessionPost, 'expected POST /session operation');
assert.ok(sessionGet.security.some((requirement) => requirement.scheme === 'sessionCookie'));
assert.equal(sessionPost.securityExempt, true);
assert.equal(sessionPost.security.length, 0);
const route = intelligence.routes.find((item) => item.path === '/users/:id');
assert.ok(route, 'expected /users/:id route');
assert.equal(route.openApiPath, '/api/users/{id}');
assert.equal(route.operations.length, 2);

const post = route.operations.find((operation) => operation.method === 'POST');
assert.ok(post, 'expected POST operation');
assert.equal(post.summary, 'Create a user');
assert.equal(post.requestBody?.contentType, 'application/json');
assert.ok(post.requestBody?.schemaRef, 'expected typed request body schema reference');
assert.ok(post.parameters.some((parameter) => parameter.name === 'id' && parameter.location === 'path'));
assert.ok(post.parameters.some((parameter) => parameter.name === 'verbose' && parameter.location === 'query'));
assert.ok(post.parameters.some((parameter) => parameter.name === 'authorization' && parameter.location === 'header'));
assert.ok(post.responses.some((response) => response.status === 201));
assert.ok(post.responses.some((response) => response.cookies.some((cookie) => cookie.name === 'session' && cookie.options.httpOnly === true)));
assert.ok(!JSON.stringify(post).includes('super-secret'), 'cookie value must not be emitted');
assert.ok(post.security.some((requirement) => requirement.scheme === 'bearerAuth'));

const get = route.operations.find((operation) => operation.method === 'GET');
assert.ok(get, 'expected GET operation');
assert.ok(get.parameters.some((parameter) => parameter.name === 'id' && parameter.location === 'path' && parameter.schema.type === 'number'));
const statusRoute = intelligence.routes.find((item) => item.path === '/status');
assert.ok(statusRoute, 'expected /status route');
const statusGet = statusRoute.operations.find((operation) => operation.method === 'GET');
assert.ok(statusGet, 'expected GET /status operation');
assert.deepEqual(statusGet.responses.map((response) => response.status).sort((a, b) => Number(a) - Number(b)), [200, 301, 307, 308, 404]);

assert.deepEqual(get.security, [], 'root middleware cookie reads must not secure unrelated routes');

assert.ok(intelligence.schemas.some((schema) => schema.name === 'CreateUser'));
assert.ok(intelligence.schemas.some((schema) => schema.name === 'User'));

const openApiJson = generateOpenApiJson(intelligence, { title: 'Fixture API', version: '2.0.0' });
interface ParsedOperation {
  security?: Array<Record<string, string[]>>;
  responses: Record<string, unknown>;
}
const parsed = JSON.parse(openApiJson) as {
  openapi: string;
  paths: Record<string, Record<string, ParsedOperation>>;
  components: { schemas?: Record<string, unknown>; securitySchemes?: Record<string, unknown> };
};
assert.equal(parsed.openapi, '3.1.0');
assert.ok(parsed.paths['/api/users/{id}']);
assert.ok(!parsed.paths['/dashboard']);
assert.ok(parsed.components.schemas && Object.keys(parsed.components.schemas).length > 0);
assert.ok(parsed.components.securitySchemes?.bearerAuth);
assert.ok(parsed.components.securitySchemes?.sessionCookie);
assert.ok(parsed.paths['/api/session'].get.security?.some((entry) => entry.sessionCookie));
assert.ok(parsed.paths['/api/session'].get.responses['202']);
assert.ok(parsed.paths['/api/session'].get.responses['401']);
assert.ok(parsed.paths['/api/session'].get.responses['403']);
assert.deepEqual(parsed.paths['/api/session'].post.security, []);
assert.ok(!parsed.paths['/api/session'].post.responses['401']);
assert.equal(parsed.paths['/api/users/{id}'].get.security, undefined);
assert.ok(!parsed.paths['/api/users/{id}'].get.responses['401']);
assert.ok(!parsed.paths['/api/users/{id}'].get.responses['403']);
assert.deepEqual(Object.keys(parsed.paths['/api/status'].get.responses).sort(), ['200', '301', '307', '308', '404']);

const openApiYaml = generateOpenApiYaml(intelligence);
assert.ok(openApiYaml.includes('"info":'));
assert.ok(openApiYaml.includes('"openapi": "3.1.0"'));

const docsHtml = generateDocsHtml(intelligence, {
  title: 'Fixture API',
  docsPath: '/docs',
  openApiJsonPath: '/openapi.json',
  openApiYamlPath: '/openapi.yaml',
});
assert.ok(docsHtml.includes('window.__VESK_DOCS__'));
assert.ok(docsHtml.includes('SwaggerUIBundle'));
assert.ok(docsHtml.includes('/docs/swagger-ui/swagger-ui-bundle.js'));
assert.ok(docsHtml.includes('/docs/swagger-ui/swagger-ui.css'));
assert.ok(docsHtml.includes('url: "/openapi.json"'));
assert.ok(docsHtml.includes('tryItOutEnabled: true'));
assert.ok(docsHtml.includes('requestInterceptor'));
assert.ok(docsHtml.includes('request.credentials = "same-origin"'));
assert.ok(docsHtml.includes('persistAuthorization: true'));
assert.ok(docsHtml.includes('/api/users/{id}'));
assert.ok(!docsHtml.includes('/dashboard'));
assert.ok(!docsHtml.includes('cdn.'));

const offlineDocsHtml = generateDocsHtml(intelligence, {
  title: 'Fixture API',
  docsPath: '/docs',
  openApiJsonPath: null,
  openApiYamlPath: null,
  playground: false,
});
assert.ok(offlineDocsHtml.includes('spec: window.__VESK_SPEC__'));
assert.ok(offlineDocsHtml.includes('tryItOutEnabled: false'));

const escapedDocsHtml = generateDocsHtml(intelligence, {
  title: 'Fixture API',
  docsPath: '/docs"><script>alert(1)</script>',
  openApiJsonPath: null,
  openApiYamlPath: null,
});
assert.ok(!escapedDocsHtml.includes('<script>alert(1)</script>'));
assert.ok(escapedDocsHtml.includes('&quot;&gt;&lt;script&gt;'));

const summary = formatInspection(inspect(intelligence), false);
assert.ok(summary.includes('Routes: 3'));
assert.ok(summary.includes('Operations: 5'));
const jsonInspect = formatInspection(inspect(intelligence, 'POST'), true);
assert.ok(JSON.parse(jsonInspect).length >= 1);

const devDocs = resolveDocsConfig(undefined, 'dev');
assert.ok(devDocs);
assert.equal(devDocs.docsPath, '/docs');
assert.equal(devDocs.openApiJsonPath, '/openapi.json');
const prodDocs = resolveDocsConfig(undefined, 'prod');
assert.ok(prodDocs);
assert.equal(prodDocs.docsPath, null);
assert.equal(prodDocs.openApiJsonPath, '/openapi.json');
const customConfig: VeskConfig = {
  docs: { prod: true, path: '/reference', openapi: { jsonPath: '/spec.json', yamlPath: '/spec.yaml' } },
};
const customDocs = resolveDocsConfig(customConfig, 'prod');
assert.ok(customDocs);
assert.equal(customDocs.docsPath, '/reference');
assert.equal(customDocs.openApiYamlPath, '/spec.yaml');
assert.equal(resolveDocsConfig({ docs: false }, 'dev'), null);
assert.equal(isIntelligenceEnabled({ intelligence: { enabled: false } }), false);
assert.equal(resolveDocsConfig({ intelligence: { enabled: false }, docs: { prod: true } }, 'prod'), null);
assert.doesNotThrow(() => validateConfig(customConfig));
assert.throws(() => validateConfig({ docs: { path: 'docs' } }));
assert.throws(() => validateConfig({ docs: { openapi: { yamlPath: '/spec.json' } } }));

const authConfig: VeskConfig = {
  docs: {
    securitySchemes: {
      sessionCookie: { type: 'apiKey', in: 'cookie', name: 'session' },
      adminKey: { type: 'apiKey', in: 'header', name: 'X-Admin-Key' },
    },
    security: [{ sessionCookie: [] }],
    auth: { credentials: 'include', persistAuthorization: false, loginPath: '/api/hello' },
  },
};
assert.doesNotThrow(() => validateConfig(authConfig));
assert.throws(() => validateConfig({ docs: { securitySchemes: { bad: { type: 'oauth2' } } } } as VeskConfig));
assert.throws(() => validateConfig({ docs: { auth: { credentials: 'never' } } } as VeskConfig));

const authArtifacts = buildIntelligenceArtifacts({
  intelligence,
  config: authConfig,
  outDir: join(root, '.vesk-auth'),
  projectRoot: root,
  environment: 'dev',
  appPaths: [],
  publicDir: join(root, 'public'),
});
const authSpec = JSON.parse(authArtifacts.openApiJson) as {
  security?: Array<Record<string, string[]>>;
  info: { description?: string };
  components: { securitySchemes?: Record<string, unknown> };
};
assert.deepEqual(authSpec.security, [{ sessionCookie: [] }]);
assert.ok(authSpec.components.securitySchemes?.adminKey);
assert.ok(authSpec.info.description?.includes('/api/hello'));
assert.ok(authArtifacts.docsHtml);
assert.ok(authArtifacts.docsHtml.includes('request.credentials = "include"'));
assert.ok(authArtifacts.docsHtml.includes('persistAuthorization: false'));

assert.equal(formatDocsUrl('http://localhost:3000', '/reference'), 'http://localhost:3000/reference');
assert.equal(formatDocsUrl('http://localhost:3000/', 'reference'), 'http://localhost:3000/reference');
assert.equal(formatDocsUrl('http://localhost:3000', null), null);

const bearerSessionConfig: VeskConfig = {
  docs: {
    dev: true,
    prod: true,
    auth: {
      credentials: 'omit',
      session: { source: 'localStorage', key: 'accessToken', scheme: 'bearerAuth' },
    },
  },
};
assert.doesNotThrow(() => validateConfig(bearerSessionConfig));
assert.throws(() => validateConfig({ docs: { auth: { session: { source: 'indexedDB', key: 'token' } } } } as VeskConfig));
assert.throws(() => validateConfig({ docs: { auth: { session: { source: 'localStorage', key: '' } } } } as VeskConfig));

const bearerArtifacts = buildIntelligenceArtifacts({
  intelligence,
  config: bearerSessionConfig,
  outDir: join(root, '.vesk-bearer'),
  projectRoot: root,
  environment: 'prod',
  appPaths: [],
  publicDir: join(root, 'public'),
});
const bearerSpec = JSON.parse(bearerArtifacts.openApiJson) as {
  components: { securitySchemes?: Record<string, { type?: string; scheme?: string; bearerFormat?: string }> };
};
assert.deepEqual(bearerSpec.components.securitySchemes?.bearerAuth, { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
assert.ok(bearerArtifacts.docsHtml);
assert.ok(bearerArtifacts.docsHtml.includes('"source":"localStorage"'));
assert.ok(bearerArtifacts.docsHtml.includes('"key":"accessToken"'));
assert.ok(bearerArtifacts.docsHtml.includes('window.localStorage'));
assert.ok(bearerArtifacts.docsHtml.includes('preauthorizeApiKey("bearerAuth", veskSessionToken)'));
assert.ok(!bearerArtifacts.docsHtml.includes('actual-jwt-value'));

const cookieSessionConfig: VeskConfig = {
  docs: {
    auth: {
      credentials: 'same-origin',
      session: { source: 'cookie', key: 'session', scheme: 'sessionCookie' },
    },
  },
};
assert.doesNotThrow(() => validateConfig(cookieSessionConfig));
const cookieArtifacts = buildIntelligenceArtifacts({
  intelligence,
  config: cookieSessionConfig,
  outDir: join(root, '.vesk-cookie'),
  projectRoot: root,
  environment: 'dev',
  appPaths: [],
  publicDir: join(root, 'public'),
});
const cookieSpec = JSON.parse(cookieArtifacts.openApiJson) as {
  components: { securitySchemes?: Record<string, { type?: string; in?: string; name?: string }> };
};
assert.deepEqual(cookieSpec.components.securitySchemes?.sessionCookie, { type: 'apiKey', in: 'cookie', name: 'session' });
assert.ok(cookieArtifacts.docsHtml);
assert.ok(cookieArtifacts.docsHtml.includes('document.cookie'));
assert.ok(cookieArtifacts.docsHtml.includes('preauthorizeApiKey("sessionCookie", veskSessionToken)'));

const artifacts = buildIntelligenceArtifacts({
  intelligence,
  config: customConfig,
  outDir: join(root, '.vesk'),
  projectRoot: root,
  environment: 'prod',
  appPaths: [],
  publicDir: join(root, 'public'),
});
assert.equal(artifacts.docsPath, '/reference');
assert.ok(artifacts.docsHtml);
assert.equal(artifacts.docsAssets.length, 3);
assert.ok(artifacts.docsAssets.some((asset) => asset.path === '/reference/swagger-ui/swagger-ui-bundle.js'));
assert.ok(artifacts.docsAssets.every((asset) => asset.content.length > 0));

const colliding = buildIntelligenceArtifacts({
  intelligence,
  config: customConfig,
  outDir: join(root, '.vesk'),
  projectRoot: root,
  environment: 'prod',
  appPaths: ['/reference'],
  publicDir: join(root, 'public'),
});
assert.equal(colliding.docsPath, null);
assert.equal(colliding.docsHtml, null);

const assetCollision = buildIntelligenceArtifacts({
  intelligence,
  config: customConfig,
  outDir: join(root, '.vesk'),
  projectRoot: root,
  environment: 'prod',
  appPaths: ['/reference/swagger-ui/swagger-ui-bundle.js'],
  publicDir: join(root, 'public'),
});
assert.equal(assetCollision.docsPath, null);
assert.equal(assetCollision.docsAssets.length, 0);

rmSync(root, { recursive: true, force: true });
console.log('docs intelligence: all checks passed');
