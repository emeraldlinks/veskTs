export interface ExportInfo {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  line: number;
  column: number;
}

export interface ComponentInfo {
  name: string;
  line: number;
  column: number;
  exported: boolean;
  defaultExport: boolean;
}

export interface DeclInfo {
  name: string;
  line: number;
  column: number;
  kind: string;
}

export interface ProjectFile {
  uri: string;
  path: string;
  exports: ExportInfo[];
  components: ComponentInfo[];
  declarations: DeclInfo[];
  lastModified: number;
}

export interface PathAlias {
  prefix: string;
  targets: string[];
}

export interface ProjectIndex {
  workspaceRoot: string;
  appDir: string | null;
  baseUrl: string;
  pathAliases: PathAlias[];
  files: Map<string, ProjectFile>;
  componentSources: Map<string, string>;
  tailwindClasses: Set<string>;
}

export interface SymbolInfo {
  name: string;
  start: number;
  end: number;
  kind: 'variable' | 'reactive' | 'import' | 'function' | 'class' | 'param' | 'interface' | 'type' | 'enum';
  type?: string;
  declStart?: number;
  declEnd?: number;
}

export interface ComponentDeclInfo {
  name: string;
  start: number;
  end: number;
  line: number;
  paramNames: string[];
  propsName: string | null;
}

export interface AttrInfo {
  name: string;
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
  isExpression: boolean;
}

export interface OpeningTagInfo {
  name: string;
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  isComponent: boolean;
  attrs: AttrInfo[];
}

export interface UsedIdentifier {
  name: string;
  start: number;
}

export interface DocAnalysis {
  symbols: Map<string, SymbolInfo[]>;
  components: ComponentDeclInfo[];
  expressions: { start: number; end: number }[];
  tags: OpeningTagInfo[];
  used: UsedIdentifier[];
  imports: Set<string>;
  ok: boolean;
}

export interface VeskSettings {
  tailwindCompletion: boolean;
  tagAutoClose: boolean;
}
