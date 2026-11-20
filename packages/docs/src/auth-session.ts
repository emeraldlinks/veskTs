import type { VeskDocsAuthConfig, VeskDocsSecuritySchemeConfig } from '@vesk/types';

export interface ResolvedDocsSessionAuth {
  source: 'cookie' | 'localStorage' | 'sessionStorage';
  key: string;
  scheme: string;
  header: string;
  prefix: string;
}

export interface DocsSessionSecurityScheme {
  id: string;
  definition: VeskDocsSecuritySchemeConfig;
}

export function resolveDocsSessionAuth(auth: VeskDocsAuthConfig | undefined): ResolvedDocsSessionAuth | null {
  const session = auth?.session;
  if (!session) return null;
  const isCookie = session.source === 'cookie';
  const header = session.header ?? (isCookie ? '' : 'Authorization');
  return {
    source: session.source,
    key: session.key,
    scheme: session.scheme ?? (isCookie ? 'sessionCookie' : 'bearerAuth'),
    header,
    prefix: session.prefix ?? (header === 'Authorization' ? 'Bearer ' : ''),
  };
}

export function sessionSecurityScheme(session: ResolvedDocsSessionAuth): DocsSessionSecurityScheme {
  if (session.source === 'cookie') {
    return { id: session.scheme, definition: { type: 'apiKey', in: 'cookie', name: session.key } };
  }
  if (session.header === 'Authorization' && session.prefix.trim().toLowerCase() === 'bearer') {
    return { id: session.scheme, definition: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } };
  }
  return { id: session.scheme, definition: { type: 'apiKey', in: 'header', name: session.header || session.key } };
}
