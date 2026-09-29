/**
 * Types for scripts/release-plan.mjs.
 *
 * The module itself is plain ESM with no build step (the publish job runs it
 * under bare node), so its declarations live here for the CLI package's
 * typecheck. Anything exported from the .mjs must be declared here or the
 * release tests stop typechecking.
 */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease label without the leading `-` (`canary.3`), or null. */
  pre: string | null;
}

export interface ClassifiedCommit {
  type: string;
  scope: string;
  breaking: boolean;
  subject: string;
}

export interface RawCommit {
  subject: string;
  body?: string;
}

export declare const STABLE: 'stable';
export declare const CHANNELS: string[];

export declare function parseVersion(version: unknown): ParsedVersion | null;
export declare function formatVersion(core: { major: number; minor: number; patch: number }, pre?: string | null): string;
export declare function compareVersions(a: string, b: string): number;
export declare function maxVersion(versions: string[]): string | null;
export declare function nextVersion(channel: string, seen: string[]): string;
export declare function classifyCommit(subject: string, body?: string): ClassifiedCommit;
export declare function renderChangelog(version: string, date: string, commits: RawCommit[]): string;
export declare function mergeChangelog(existing: string, section: string): string;
export declare function isChannel(value: unknown): boolean;
