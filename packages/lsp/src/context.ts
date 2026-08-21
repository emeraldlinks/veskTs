/** @module context — Shared LSP state: connection, document store, project index, settings. */

import { createConnection, TextDocuments, ProposedFeatures } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ProjectIndex, VeskSettings, TypeDeclaration } from './types';

/** LSP connection over stdio. */
export const connection = createConnection(ProposedFeatures.all);

/** Open-document store managed by vscode-languageserver. */
export const documents = new TextDocuments(TextDocument);

/** Mutable workspace index, rebuilt on `onInitialize`. */
export let project: ProjectIndex = {
  workspaceRoot: '',
  appDir: null,
  baseUrl: '',
  pathAliases: [],
  files: new Map(),
  componentSources: new Map(),
  tailwindClasses: new Set(),
  typeDeclarations: new Map(),
  dtsSources: new Map(),
};

/** Replace the current project index. */
export function setProject(next: ProjectIndex): void {
  project = next;
}

/** Client-provided settings. */
export let settings: VeskSettings = { tailwindCompletion: true, tagAutoClose: true };

/** Merge client-provided settings. */
export function readSettings(partial: unknown): void {
  const vesk = (partial as Record<string, unknown>)?.vesk as Record<string, unknown> | undefined ?? {};
  settings = {
    tailwindCompletion: vesk['tailwind.completion'] !== false,
    tagAutoClose: vesk['tagAutoClose'] !== false,
  };
}
