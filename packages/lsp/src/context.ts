import { createConnection, TextDocuments, ProposedFeatures } from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { ProjectIndex, VeskSettings } from './types';

// Shared connection and open-document store. Feature modules import these
// directly; `project` is the mutable workspace index rebuilt on initialize.
export const connection = createConnection(ProposedFeatures.all);
export const documents = new TextDocuments(TextDocument);

export let project: ProjectIndex = {
  workspaceRoot: '',
  appDir: null,
  baseUrl: '',
  pathAliases: [],
  files: new Map(),
  componentSources: new Map(),
  tailwindClasses: new Set(),
};

export function setProject(next: ProjectIndex): void {
  project = next;
}

export let settings: VeskSettings = { tailwindCompletion: true, tagAutoClose: true };

export function readSettings(partial: any): void {
  const vesk = partial?.vesk || {};
  settings = {
    tailwindCompletion: vesk['tailwind.completion'] !== false,
    tagAutoClose: vesk['tagAutoClose'] !== false,
  };
}
