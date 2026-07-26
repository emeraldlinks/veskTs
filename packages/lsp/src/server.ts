import { parse, scanRoutes, scanComponents, collectSources, matchUrl } from '@vesk/compiler';
import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  CompletionItem,
  CompletionItemKind,
  InsertTextFormat,
  TextDocumentSyncKind,
  Hover,
  HoverParams,
  MarkupKind,
  SymbolInformation,
  SymbolKind,
  Position,
  FoldingRange,
  FoldingRangeParams,
  DefinitionParams,
  Location,
  LocationLink,
  ReferenceParams,
  DocumentHighlight,
  DocumentHighlightKind,
  CompletionParams,
  SignatureHelp,
  SignatureHelpParams,
  SignatureInformation,
  CodeActionParams,
  CodeAction,
  CodeActionKind,
  TextEdit,
  DidChangeWatchedFilesParams,
  FileChangeType,
  DocumentOnTypeFormattingParams,
  ColorInformation,
  Color,
  ColorPresentation,
  ColorPresentationParams,
  DocumentColorParams,
  RenameParams,
  WorkspaceEdit,
  PrepareRenameParams,
  Range,
  DocumentLink,
  DocumentLinkParams,
  SemanticTokensParams,
  SemanticTokens,
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
} from 'vscode-languageserver/node.js';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { readFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'fs';
import { resolve, dirname, extname, relative, join } from 'path';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// ── Project index ──────────────────────────────────────────────

interface ExportInfo {
  name: string;
  isDefault: boolean;
  isReExport: boolean;
  line: number;
  column: number;
}

interface ComponentInfo {
  name: string;
  line: number;
  column: number;
  exported: boolean;
  defaultExport: boolean;
}

interface DeclInfo {
  name: string;
  line: number;
  column: number;
  kind: string;
}

interface ProjectFile {
  uri: string;
  path: string;
  exports: ExportInfo[];
  components: ComponentInfo[];
  declarations: DeclInfo[];
  lastModified: number;
}

interface PathAlias {
  prefix: string;
  targets: string[];
}

interface ProjectIndex {
  workspaceRoot: string;
  appDir: string | null;
  baseUrl: string;
  pathAliases: PathAlias[];
  files: Map<string, ProjectFile>;
  componentSources: Map<string, string>;
  tailwindClasses: Set<string>;
}

let project: ProjectIndex = {
  workspaceRoot: '',
  appDir: null,
  baseUrl: '',
  pathAliases: [],
  files: new Map(),
  componentSources: new Map(),
  tailwindClasses: new Set(),
};

// ── Intrinsics (auto-imported from @vesk/runtime) ─────────────

const VESK_INTRINSICS: { name: string; kind: CompletionItemKind; detail: string; docs: string; insertText?: string }[] = [
  { name: 'track', kind: CompletionItemKind.Function, detail: 'Create a reactive signal', docs: 'Creates a reactive value. Returns a getter `fn()` that returns the value.' },
  { name: 'get', kind: CompletionItemKind.Function, detail: 'Get reactive signal value', docs: 'Returns the current value of a reactive signal.' },
  { name: 'set', kind: CompletionItemKind.Function, detail: 'Set reactive signal value', docs: 'Sets a new value on a reactive signal and triggers updates.' },
  { name: 'derived', kind: CompletionItemKind.Function, detail: 'Create derived reactive value', docs: 'Creates a derived signal that recomputes when dependencies change.' },
  { name: 'effect', kind: CompletionItemKind.Function, detail: 'Run side effect on reactive changes', docs: 'Runs a function whenever its reactive dependencies change.' },
  { name: 'root', kind: CompletionItemKind.Function, detail: 'Create reactive root scope', docs: 'Creates a root scope for reactive computations.' },
  { name: 'Link', kind: CompletionItemKind.Class, detail: 'Client-side navigation link', docs: '<Link href="/path"> — SPA link component.' },
  { name: 'NavLink', kind: CompletionItemKind.Class, detail: 'Navigation link with active state', docs: '<NavLink href="/path" class="..." activeClass="..."> — link that highlights when active.' },
  { name: 'Outlet', kind: CompletionItemKind.Class, detail: 'Nested route outlet', docs: '<Outlet /> — renders matched child route.' },
  { name: 'useRouter', kind: CompletionItemKind.Function, detail: 'Access router instance', docs: 'Returns the router instance with navigate(), prefetch(), etc.' },
  { name: 'useNavigate', kind: CompletionItemKind.Function, detail: 'Navigate programmatically', docs: 'Returns a navigate function to programmatically navigate.' },
  { name: 'useParams', kind: CompletionItemKind.Function, detail: 'Access route parameters', docs: 'Returns the current route parameters object.' },
  { name: 'usePathname', kind: CompletionItemKind.Function, detail: 'Access current pathname', docs: 'Returns the current URL pathname as a reactive string.' },
  { name: 'useSearchParams', kind: CompletionItemKind.Function, detail: 'Access search parameters', docs: 'Returns reactive search params with get/set/delete.' },
  { name: 'useFetch', kind: CompletionItemKind.Function, detail: 'Data fetching with SSR support', docs: 'useFetch(url) — fetches data with SSR hydration support.' },
  { name: 'Form', kind: CompletionItemKind.Class, detail: 'SSR-first form component', docs: '<Form action="/api/submit" onSubmit={...}> — validates and submits forms.' },
  { name: 'Field', kind: CompletionItemKind.Class, detail: 'Form field with validation', docs: '<Field name="email" required email> — form field with validation display.' },
  { name: 'required', kind: CompletionItemKind.Function, detail: 'Validation: required', docs: 'required("Custom message?") — validates value is non-empty.' },
  { name: 'email', kind: CompletionItemKind.Function, detail: 'Validation: email format', docs: 'email("Custom message?") — validates email format.' },
  { name: 'minLength', kind: CompletionItemKind.Function, detail: 'Validation: minimum length', docs: 'minLength(3, "Custom message?") — validates minimum string length.' },
  { name: 'maxLength', kind: CompletionItemKind.Function, detail: 'Validation: maximum length', docs: 'maxLength(100, "Custom message?") — validates maximum string length.' },
  { name: 'pattern', kind: CompletionItemKind.Function, detail: 'Validation: regex pattern', docs: 'pattern(/^[a-z]+$/, "Custom message?") — validates against regex.' },
  { name: 'custom', kind: CompletionItemKind.Function, detail: 'Custom validation', docs: 'custom(fn, "Message") — custom validation function.' },
  { name: 'Experiment', kind: CompletionItemKind.Class, detail: 'A/B testing component', docs: '<Experiment name="test" variants={[...]}> — A/B test variants.' },
  { name: 'Image', kind: CompletionItemKind.Class, detail: 'Optimized image component', docs: '<Image src="/photo.jpg" width={800} height={600} /> — responsive, lazy images.' },
  { name: 'JsonLd', kind: CompletionItemKind.Class, detail: 'JSON-LD structured data', docs: '<JsonLd schema={ArticleSchema({...})} /> — injects structured data.' },
  { name: 'Portal', kind: CompletionItemKind.Class, detail: 'Portal to another DOM node', docs: '<Portal container={document.body}>content</Portal>.' },
  { name: 'Head', kind: CompletionItemKind.Class, detail: 'Document head element', docs: '<Head><title>...</title><meta ...></Head> — injects into <head>.' },
  { name: 'slot', kind: CompletionItemKind.Keyword, detail: 'Component slot for children', docs: '<slot /> — renders children passed to the component.' },
  { name: 'reconcile', kind: CompletionItemKind.Function, detail: 'Array reconciliation', docs: 'reconcile(arr, key) — efficient list diffing.' },
  { name: 'redirect', kind: CompletionItemKind.Function, detail: 'Redirect to another route', docs: 'redirect("/path") — throws a redirect.' },
  { name: 'permanentRedirect', kind: CompletionItemKind.Function, detail: 'Permanent redirect (301)', docs: 'permanentRedirect("/path") — throws a permanent redirect.' },
  { name: 'notFound', kind: CompletionItemKind.Function, detail: 'Throw 404', docs: 'notFound() — throws a not-found response.' },
];

// ── Tailwind CSS classes (comprehensive subset) ────────────────

const TAILWIND_CLASSES = [
  // Layout
  'container', 'block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid',
  'table', 'table-row', 'table-cell', 'hidden', 'flow-root', 'contents',
  // Flexbox
  'flex-row', 'flex-row-reverse', 'flex-col', 'flex-col-reverse', 'flex-wrap', 'flex-nowrap',
  'flex-1', 'flex-auto', 'flex-initial', 'flex-none', 'grow', 'grow-0', 'shrink', 'shrink-0',
  'justify-start', 'justify-end', 'justify-center', 'justify-between', 'justify-around', 'justify-evenly',
  'items-start', 'items-end', 'items-center', 'items-baseline', 'items-stretch',
  'content-start', 'content-end', 'content-center', 'content-between', 'content-around',
  'self-start', 'self-end', 'self-center', 'self-stretch', 'self-baseline',
  // Grid
  'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4', 'grid-cols-5', 'grid-cols-6',
  'grid-cols-7', 'grid-cols-8', 'grid-cols-9', 'grid-cols-10', 'grid-cols-11', 'grid-cols-12',
  'grid-cols-none', 'col-span-1', 'col-span-2', 'col-span-3', 'col-span-4', 'col-span-5', 'col-span-6',
  'col-span-full', 'col-start-1', 'col-end-1',
  'grid-rows-1', 'grid-rows-2', 'grid-rows-3', 'grid-rows-4', 'grid-rows-5', 'grid-rows-6',
  'row-span-1', 'row-span-2', 'row-span-3', 'row-span-full',
  'gap-0', 'gap-1', 'gap-2', 'gap-3', 'gap-4', 'gap-5', 'gap-6', 'gap-8', 'gap-10', 'gap-12',
  'gap-x-0', 'gap-x-1', 'gap-x-2', 'gap-x-4', 'gap-x-8',
  'gap-y-0', 'gap-y-1', 'gap-y-2', 'gap-y-4', 'gap-y-8',
  // Spacing
  'p-0', 'p-1', 'p-2', 'p-3', 'p-4', 'p-5', 'p-6', 'p-8', 'p-10', 'p-12', 'p-16', 'p-20', 'p-24',
  'px-0', 'px-1', 'px-2', 'px-3', 'px-4', 'px-5', 'px-6', 'px-8', 'px-10',
  'py-0', 'py-1', 'py-2', 'py-3', 'py-4', 'py-5', 'py-6', 'py-8', 'py-10',
  'pt-0', 'pt-1', 'pt-2', 'pt-3', 'pt-4', 'pt-5', 'pt-6', 'pt-8',
  'pb-0', 'pb-1', 'pb-2', 'pb-3', 'pb-4', 'pb-5', 'pb-6', 'pb-8',
  'pl-0', 'pl-1', 'pl-2', 'pl-3', 'pl-4', 'pl-5', 'pl-6', 'pl-8',
  'pr-0', 'pr-1', 'pr-2', 'pr-3', 'pr-4', 'pr-5', 'pr-6', 'pr-8',
  'm-0', 'm-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-8', 'm-10', 'm-12', 'm-16', 'm-20', 'm-auto',
  'mx-0', 'mx-1', 'mx-2', 'mx-3', 'mx-4', 'mx-5', 'mx-6', 'mx-8', 'mx-auto',
  'my-0', 'my-1', 'my-2', 'my-3', 'my-4', 'my-5', 'my-6', 'my-8', 'my-auto',
  'mt-0', 'mt-1', 'mt-2', 'mt-3', 'mt-4', 'mt-5', 'mt-6', 'mt-8', 'mt-auto',
  'mb-0', 'mb-1', 'mb-2', 'mb-3', 'mb-4', 'mb-5', 'mb-6', 'mb-8', 'mb-auto',
  'ml-0', 'ml-1', 'ml-2', 'ml-3', 'ml-4', 'ml-auto',
  'mr-0', 'mr-1', 'mr-2', 'mr-3', 'mr-4', 'mr-auto',
  'space-x-0', 'space-x-1', 'space-x-2', 'space-x-3', 'space-x-4', 'space-x-8',
  'space-y-0', 'space-y-1', 'space-y-2', 'space-y-3', 'space-y-4', 'space-y-8',
  // Sizing
  'w-0', 'w-1', 'w-2', 'w-3', 'w-4', 'w-5', 'w-6', 'w-8', 'w-10', 'w-12', 'w-16', 'w-20', 'w-24',
  'w-32', 'w-40', 'w-48', 'w-56', 'w-64', 'w-auto', 'w-1/2', 'w-1/3', 'w-2/3', 'w-1/4', 'w-3/4',
  'w-full', 'w-screen', 'w-min', 'w-max', 'w-fit',
  'h-0', 'h-1', 'h-2', 'h-3', 'h-4', 'h-5', 'h-6', 'h-8', 'h-10', 'h-12', 'h-16', 'h-20', 'h-24',
  'h-auto', 'h-1/2', 'h-1/3', 'h-2/3', 'h-1/4', 'h-3/4', 'h-full', 'h-screen', 'h-min', 'h-max', 'h-fit',
  'min-w-0', 'min-w-full', 'min-w-min', 'min-w-max',
  'min-h-0', 'min-h-full', 'min-h-screen',
  'max-w-0', 'max-w-none', 'max-w-xs', 'max-w-sm', 'max-w-md', 'max-w-lg', 'max-w-xl', 'max-w-2xl',
  'max-w-3xl', 'max-w-4xl', 'max-w-5xl', 'max-w-6xl', 'max-w-7xl', 'max-w-full', 'max-w-screen-xl',
  'max-h-0', 'max-h-full', 'max-h-screen',
  // Typography
  'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl', 'text-4xl',
  'text-5xl', 'text-6xl', 'text-7xl', 'text-8xl', 'text-9xl',
  'font-thin', 'font-extralight', 'font-light', 'font-normal', 'font-medium', 'font-semibold',
  'font-bold', 'font-extrabold', 'font-black',
  'text-left', 'text-center', 'text-right', 'text-justify', 'text-start', 'text-end',
  'italic', 'not-italic', 'underline', 'line-through', 'no-underline', 'overline',
  'uppercase', 'lowercase', 'capitalize', 'normal-case',
  'leading-none', 'leading-tight', 'leading-snug', 'leading-normal', 'leading-relaxed', 'leading-loose',
  'tracking-tighter', 'tracking-tight', 'tracking-normal', 'tracking-wide', 'tracking-wider', 'tracking-widest',
  'whitespace-normal', 'whitespace-nowrap', 'whitespace-pre', 'whitespace-pre-line', 'whitespace-pre-wrap',
  'break-normal', 'break-words', 'break-all', 'truncate',
  'list-none', 'list-disc', 'list-decimal', 'list-inside', 'list-outside',
  // Backgrounds
  'bg-transparent', 'bg-black', 'bg-white', 'bg-gray-50', 'bg-gray-100', 'bg-gray-200',
  'bg-gray-300', 'bg-gray-400', 'bg-gray-500', 'bg-gray-600', 'bg-gray-700', 'bg-gray-800', 'bg-gray-900',
  'bg-red-50', 'bg-red-100', 'bg-red-200', 'bg-red-500', 'bg-red-600', 'bg-red-700',
  'bg-blue-50', 'bg-blue-100', 'bg-blue-200', 'bg-blue-500', 'bg-blue-600', 'bg-blue-700',
  'bg-green-50', 'bg-green-100', 'bg-green-200', 'bg-green-500', 'bg-green-600', 'bg-green-700',
  'bg-yellow-50', 'bg-yellow-100', 'bg-yellow-200', 'bg-yellow-500', 'bg-yellow-600',
  'bg-purple-50', 'bg-purple-100', 'bg-purple-500', 'bg-purple-600',
  'bg-cover', 'bg-contain', 'bg-center', 'bg-top', 'bg-bottom', 'bg-no-repeat', 'bg-repeat',
  // Borders
  'border', 'border-0', 'border-2', 'border-4', 'border-8',
  'border-t', 'border-b', 'border-l', 'border-r', 'border-x', 'border-y',
  'border-transparent', 'border-black', 'border-white',
  'border-gray-100', 'border-gray-200', 'border-gray-300', 'border-gray-400', 'border-gray-500',
  'border-red-500', 'border-blue-500', 'border-green-500',
  'rounded-none', 'rounded-sm', 'rounded', 'rounded-md', 'rounded-lg', 'rounded-xl', 'rounded-2xl',
  'rounded-3xl', 'rounded-full',
  'rounded-t', 'rounded-b', 'rounded-l', 'rounded-r',
  // Effects
  'shadow-sm', 'shadow', 'shadow-md', 'shadow-lg', 'shadow-xl', 'shadow-2xl', 'shadow-none',
  'opacity-0', 'opacity-5', 'opacity-10', 'opacity-25', 'opacity-50', 'opacity-75', 'opacity-100',
  // Transitions
  'transition', 'transition-none', 'transition-all', 'transition-colors', 'transition-opacity',
  'transition-shadow', 'transition-transform',
  'duration-75', 'duration-100', 'duration-150', 'duration-200', 'duration-300', 'duration-500',
  'ease-linear', 'ease-in', 'ease-out', 'ease-in-out',
  // Transform
  'scale-0', 'scale-50', 'scale-75', 'scale-90', 'scale-95', 'scale-100', 'scale-105', 'scale-110',
  'rotate-0', 'rotate-45', 'rotate-90', 'rotate-180',
  'translate-x-0', 'translate-x-1', 'translate-x-2', 'translate-x-3', 'translate-x-4',
  'translate-y-0', 'translate-y-1', 'translate-y-2', 'translate-y-3', 'translate-y-4',
  // Interactivity
  'cursor-pointer', 'cursor-default', 'cursor-not-allowed', 'cursor-wait', 'cursor-text',
  'select-none', 'select-text', 'select-all', 'select-auto',
  'resize-none', 'resize', 'resize-y', 'resize-x',
  'pointer-events-none', 'pointer-events-auto',
  // Position
  'static', 'fixed', 'absolute', 'relative', 'sticky',
  'inset-0', 'inset-x-0', 'inset-y-0',
  'top-0', 'right-0', 'bottom-0', 'left-0',
  'z-0', 'z-10', 'z-20', 'z-30', 'z-40', 'z-50', 'z-auto',
  // Overflow
  'overflow-auto', 'overflow-hidden', 'overflow-visible', 'overflow-scroll',
  'overflow-x-auto', 'overflow-y-auto',
  'overscroll-auto', 'overscroll-contain', 'overscroll-none',
];

// ── HTML elements ──────────────────────────────────────────────

const HTML_ELEMENTS = [
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio',
  'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br', 'button',
  'canvas', 'caption', 'cite', 'code', 'col', 'colgroup',
  'data', 'datalist', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt',
  'em', 'embed',
  'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html',
  'i', 'iframe', 'img', 'input', 'ins',
  'kbd',
  'label', 'legend', 'li', 'link',
  'main', 'map', 'mark', 'menu', 'meta', 'meter',
  'nav', 'noscript',
  'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'picture', 'portal', 'pre', 'progress',
  'q',
  'rp', 'rt', 'ruby',
  's', 'samp', 'script', 'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track',
  'u', 'ul',
  'var', 'video',
  'wbr',
];

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// ── CSS knowledge ───────────────────────────────────────────────

const CSS_PROPERTIES: Record<string, { values: string[], description: string }> = {
  'color': { values: ['inherit', 'initial', 'transparent', 'currentColor'], description: 'Text color' },
  'background-color': { values: ['inherit', 'initial', 'transparent'], description: 'Background color' },
  'background': { values: ['inherit', 'initial', 'none', 'transparent'], description: 'Background shorthand' },
  'background-image': { values: ['none', 'inherit', 'initial'], description: 'Background image' },
  'background-size': { values: ['auto', 'cover', 'contain', 'inherit'], description: 'Background size' },
  'background-position': { values: ['center', 'top', 'bottom', 'left', 'right', 'inherit'], description: 'Background position' },
  'background-repeat': { values: ['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'inherit'], description: 'Background repeat' },
  'margin': { values: ['auto', 'inherit', 'initial'], description: 'Margin shorthand' },
  'margin-top': { values: ['auto', 'inherit'], description: 'Margin top' },
  'margin-right': { values: ['auto', 'inherit'], description: 'Margin right' },
  'margin-bottom': { values: ['auto', 'inherit'], description: 'Margin bottom' },
  'margin-left': { values: ['auto', 'inherit'], description: 'Margin left' },
  'padding': { values: ['inherit', 'initial'], description: 'Padding shorthand' },
  'padding-top': { values: ['inherit'], description: 'Padding top' },
  'padding-right': { values: ['inherit'], description: 'Padding right' },
  'padding-bottom': { values: ['inherit'], description: 'Padding bottom' },
  'padding-left': { values: ['inherit'], description: 'Padding left' },
  'width': { values: ['auto', 'inherit', 'initial', '100%', '100vw', 'fit-content', 'max-content', 'min-content'], description: 'Width' },
  'height': { values: ['auto', 'inherit', 'initial', '100%', '100vh', 'fit-content', 'max-content', 'min-content'], description: 'Height' },
  'min-width': { values: ['auto', 'inherit', 'initial'], description: 'Minimum width' },
  'min-height': { values: ['auto', 'inherit', 'initial'], description: 'Minimum height' },
  'max-width': { values: ['none', 'inherit', 'initial'], description: 'Maximum width' },
  'max-height': { values: ['none', 'inherit', 'initial'], description: 'Maximum height' },
  'display': { values: ['block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'none', 'contents', 'table', 'flow-root', 'inherit'], description: 'Display type' },
  'position': { values: ['static', 'relative', 'absolute', 'fixed', 'sticky', 'inherit'], description: 'Positioning' },
  'top': { values: ['auto', 'inherit', 'initial'], description: 'Top offset' },
  'right': { values: ['auto', 'inherit', 'initial'], description: 'Right offset' },
  'bottom': { values: ['auto', 'inherit', 'initial'], description: 'Bottom offset' },
  'left': { values: ['auto', 'inherit', 'initial'], description: 'Left offset' },
  'flex-direction': { values: ['row', 'row-reverse', 'column', 'column-reverse', 'inherit'], description: 'Flex direction' },
  'flex-wrap': { values: ['nowrap', 'wrap', 'wrap-reverse', 'inherit'], description: 'Flex wrap' },
  'flex': { values: ['none', 'auto', 'inherit', 'initial'], description: 'Flex shorthand' },
  'flex-grow': { values: ['0', '1', 'inherit'], description: 'Flex grow factor' },
  'flex-shrink': { values: ['0', '1', 'inherit'], description: 'Flex shrink factor' },
  'flex-basis': { values: ['auto', '0', '100%', 'inherit'], description: 'Flex basis' },
  'justify-content': { values: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly', 'inherit'], description: 'Justify content' },
  'align-items': { values: ['flex-start', 'flex-end', 'center', 'baseline', 'stretch', 'inherit'], description: 'Align items' },
  'align-self': { values: ['auto', 'flex-start', 'flex-end', 'center', 'baseline', 'stretch', 'inherit'], description: 'Align self' },
  'align-content': { values: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'stretch', 'inherit'], description: 'Align content' },
  'gap': { values: ['normal', 'inherit'], description: 'Gap between items' },
  'column-gap': { values: ['normal', 'inherit'], description: 'Column gap' },
  'row-gap': { values: ['normal', 'inherit'], description: 'Row gap' },
  'grid-template-columns': { values: ['none', 'inherit'], description: 'Grid column template' },
  'grid-template-rows': { values: ['none', 'inherit'], description: 'Grid row template' },
  'grid-column': { values: ['auto', 'inherit'], description: 'Grid column' },
  'grid-row': { values: ['auto', 'inherit'], description: 'Grid row' },
  'grid-area': { values: ['auto', 'inherit'], description: 'Grid area' },
  'font-size': { values: ['xx-small', 'x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'smaller', 'larger', 'inherit', 'initial'], description: 'Font size' },
  'font-weight': { values: ['normal', 'bold', 'bolder', 'lighter', '100', '200', '300', '400', '500', '600', '700', '800', '900', 'inherit'], description: 'Font weight' },
  'font-family': { values: ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'inherit'], description: 'Font family' },
  'font-style': { values: ['normal', 'italic', 'oblique', 'inherit'], description: 'Font style' },
  'text-align': { values: ['left', 'right', 'center', 'justify', 'inherit'], description: 'Text alignment' },
  'text-decoration': { values: ['none', 'underline', 'overline', 'line-through', 'inherit'], description: 'Text decoration' },
  'text-transform': { values: ['none', 'capitalize', 'uppercase', 'lowercase', 'inherit'], description: 'Text transform' },
  'line-height': { values: ['normal', 'inherit'], description: 'Line height' },
  'letter-spacing': { values: ['normal', 'inherit'], description: 'Letter spacing' },
  'white-space': { values: ['normal', 'nowrap', 'pre', 'pre-wrap', 'pre-line', 'inherit'], description: 'White space handling' },
  'overflow': { values: ['visible', 'hidden', 'scroll', 'auto', 'inherit'], description: 'Overflow handling' },
  'overflow-x': { values: ['visible', 'hidden', 'scroll', 'auto', 'inherit'], description: 'Horizontal overflow' },
  'overflow-y': { values: ['visible', 'hidden', 'scroll', 'auto', 'inherit'], description: 'Vertical overflow' },
  'border': { values: ['none', 'inherit', 'initial'], description: 'Border shorthand' },
  'border-width': { values: ['thin', 'medium', 'thick', 'inherit'], description: 'Border width' },
  'border-style': { values: ['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset', 'inherit'], description: 'Border style' },
  'border-color': { values: ['transparent', 'inherit', 'initial'], description: 'Border color' },
  'border-radius': { values: ['inherit', 'initial'], description: 'Border radius' },
  'border-collapse': { values: ['collapse', 'separate', 'inherit'], description: 'Border collapse' },
  'box-shadow': { values: ['none', 'inherit', 'initial'], description: 'Box shadow' },
  'opacity': { values: ['0', '0.5', '1', 'inherit'], description: 'Opacity' },
  'cursor': { values: ['auto', 'default', 'pointer', 'wait', 'text', 'move', 'not-allowed', 'crosshair', 'help', 'inherit'], description: 'Cursor type' },
  'z-index': { values: ['auto', '0', '1', '-1', 'inherit'], description: 'Z-index' },
  'visibility': { values: ['visible', 'hidden', 'collapse', 'inherit'], description: 'Visibility' },
  'transform': { values: ['none', 'inherit', 'initial'], description: 'Transform' },
  'transition': { values: ['none', 'all', 'inherit'], description: 'Transition shorthand' },
  'transition-duration': { values: ['0s', '0.15s', '0.2s', '0.3s', '0.5s', '1s', 'inherit'], description: 'Transition duration' },
  'transition-timing-function': { values: ['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end', 'inherit'], description: 'Transition timing' },
  'animation': { values: ['none', 'inherit'], description: 'Animation shorthand' },
  'list-style': { values: ['none', 'disc', 'circle', 'square', 'decimal', 'inherit'], description: 'List style' },
  'outline': { values: ['none', 'inherit', 'initial'], description: 'Outline shorthand' },
  'outline-style': { values: ['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'inherit'], description: 'Outline style' },
  'outline-width': { values: ['thin', 'medium', 'thick', 'inherit'], description: 'Outline width' },
  'outline-color': { values: ['transparent', 'inherit', 'initial'], description: 'Outline color' },
  'box-sizing': { values: ['content-box', 'border-box', 'inherit'], description: 'Box sizing' },
  'float': { values: ['none', 'left', 'right', 'inherit'], description: 'Float' },
  'clear': { values: ['none', 'left', 'right', 'both', 'inherit'], description: 'Clear' },
  'pointer-events': { values: ['auto', 'none', 'inherit'], description: 'Pointer events' },
  'user-select': { values: ['auto', 'none', 'text', 'all', 'inherit'], description: 'User select' },
  'object-fit': { values: ['fill', 'contain', 'cover', 'none', 'scale-down', 'inherit'], description: 'Object fit' },
  'object-position': { values: ['center', 'top', 'bottom', 'left', 'right', 'inherit'], description: 'Object position' },
  'word-break': { values: ['normal', 'break-all', 'keep-all', 'inherit'], description: 'Word break' },
  'overflow-wrap': { values: ['normal', 'break-word', 'anywhere', 'inherit'], description: 'Overflow wrap' },
  'text-overflow': { values: ['clip', 'ellipsis', 'inherit'], description: 'Text overflow' },
  'resize': { values: ['none', 'both', 'horizontal', 'vertical', 'inherit'], description: 'Resize' },
  'vertical-align': { values: ['baseline', 'top', 'middle', 'bottom', 'text-top', 'text-bottom', 'sub', 'super', 'inherit'], description: 'Vertical alignment' },
  'direction': { values: ['ltr', 'rtl', 'inherit'], description: 'Text direction' },
  'tab-size': { values: ['2', '4', '8', 'inherit'], description: 'Tab size' },
  'filter': { values: ['none', 'inherit', 'initial'], description: 'CSS filter' },
  'clip-path': { values: ['none', 'inherit'], description: 'Clip path' },
};

function isInsideStyleBlock(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(0, offset);
  const after = text.substring(offset);
  const lastStyleOpen = before.lastIndexOf('<style');
  const lastStyleClose = before.lastIndexOf('</style>');
  if (lastStyleOpen === -1) return false;
  if (lastStyleClose > lastStyleOpen) return false;
  const nextClose = after.indexOf('</style>');
  if (nextClose === -1) return false;
  return true;
}

function getCSSPrefix(document: TextDocument, position: Position): { property: string; valuePrefix: string } {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 500), offset);
  const lines = before.split('\n');
  const currentLine = lines[lines.length - 1];
  const colonIdx = currentLine.lastIndexOf(':');
  if (colonIdx !== -1) {
    const prop = currentLine.substring(0, colonIdx).trim();
    const valAfter = currentLine.substring(colonIdx + 1);
    const valMatch = valAfter.match(/([\w-]*)$/);
    return { property: prop, valuePrefix: valMatch?.[1] || '' };
  }
  const propMatch = currentLine.match(/([\w-]*)\s*$/);
  return { property: '', valuePrefix: propMatch?.[1] || '' };
}

// ── Path alias resolution ───────────────────────────────────────

function loadTsconfig(root: string): { baseUrl: string; pathAliases: PathAlias[] } {
  const candidates = [join(root, 'tsconfig.json'), join(root, 'jsconfig.json')];
  for (const tsconfigPath of candidates) {
    if (!existsSync(tsconfigPath)) continue;
    try {
      const raw = readFileSync(tsconfigPath, 'utf-8');
      const config = JSON.parse(raw);
      const compilerOptions = config.compilerOptions || {};
      const baseUrl = compilerOptions.baseUrl ? resolve(root, compilerOptions.baseUrl) : root;
      const paths = compilerOptions.paths || {};
      const pathAliases: PathAlias[] = [];
      for (const [key, targets] of Object.entries(paths)) {
        if (key.endsWith('/*') && Array.isArray(targets)) {
          pathAliases.push({
            prefix: key.slice(0, -2),
            targets: targets.map((t: string) => resolve(baseUrl, t.replace(/\/\*$/, ''))),
          });
        }
      }
      return { baseUrl, pathAliases };
    } catch {}
  }
  return { baseUrl: root, pathAliases: [] };
}

function resolveAlias(importPath: string, project: ProjectIndex): string | null {
  for (const alias of project.pathAliases) {
    if (importPath === alias.prefix) {
      return alias.targets[0] || null;
    }
    if (importPath.startsWith(alias.prefix + '/')) {
      const suffix = importPath.slice(alias.prefix.length + 1);
      for (const target of alias.targets) {
        const resolved = join(target, suffix);
        const candidates = [resolved, `${resolved}.vsk`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`];
        for (const c of candidates) {
          if (existsSync(c)) return c;
        }
        // Check for index files
        for (const ext of ['.vsk', '.ts', '.tsx', '.js', '.jsx']) {
          const idx = join(resolved, `index${ext}`);
          if (existsSync(idx)) return idx;
        }
      }
    }
  }
  return null;
}

function resolveImportPath(importPath: string, fromFile: string, project: ProjectIndex): string | null {
  // Try alias first
  if (importPath.startsWith('@')) {
    const aliased = resolveAlias(importPath, project);
    if (aliased) return aliased;
  }
  // Relative path
  if (importPath.startsWith('.')) {
    const dir = dirname(fromFile);
    const resolved = resolve(dir, importPath);
    const candidates = [resolved, `${resolved}.vsk`, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`, `${resolved}.jsx`];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
    // Index files
    for (const ext of ['.vsk', '.ts', '.tsx', '.js', '.jsx']) {
      const idx = join(resolved, `index${ext}`);
      if (existsSync(idx)) return idx;
    }
  }
  return null;
}

function isExportedFromFile(name: string, filePath: string): boolean {
  const file = project.files.get(filePath);
  if (!file) return false;
  return file.exports.some(e => e.name === name);
}

function getExportNames(filePath: string): string[] {
  const file = project.files.get(filePath);
  if (!file) return [];
  return file.exports.map(e => e.name);
}

// ── Project scanning ──────────────────────────────────────────

function findAppDir(root: string): string | null {
  const candidates = [resolve(root, 'app'), resolve(root, 'src', 'app')];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return null;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;
  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.')) continue;
      if (entry === 'node_modules' || entry === '.vesk') continue;
      const full = join(dir, entry);
      try {
        const s = statSync(full);
        if (s.isDirectory()) {
          results.push(...walkDir(full));
        } else if (s.isFile() && /\.(vsk|ts|tsx|js|jsx)$/.test(entry)) {
          results.push(full);
        }
      } catch {}
    }
  } catch {}
  return results;
}

function parseExports(source: string, language: string): ExportInfo[] {
  const exports: ExportInfo[] = [];
  const lines = source.split('\n');
  // Named exports: export function foo, export const foo, export class foo
  const namedRe = /^export\s+(?:async\s+)?(?:default\s+)?(?:function|const|let|var|class)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = namedRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    const isDefault = m[0].includes('default');
    exports.push({ name: m[1], isDefault, isReExport: false, line, column: col + m[0].indexOf(m[1]) });
  }
  // export { foo, bar as baz }
  const exportListRe = /export\s*\{([^}]+)\}/g;
  while ((m = exportListRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    for (const item of m[1].split(',')) {
      const name = item.trim().split(/\s+as\s+/)[0].trim();
      if (name) exports.push({ name, isDefault: false, isReExport: true, line, column: col + m[0].indexOf(name) });
    }
  }
  // Vesk component exports: export component Foo
  const vskCompRe = /(?:export\s+)(?:default\s+)?component\s+(\w+)/g;
  while ((m = vskCompRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    const isDefault = m[0].includes('default');
    exports.push({ name: m[1], isDefault, isReExport: false, line, column: col + m[0].indexOf(m[1]) });
  }
  return exports;
}

function parseDeclarations(source: string, language: string): { name: string; line: number; column: number; kind: string }[] {
  const decls: { name: string; line: number; column: number; kind: string }[] = [];
  const lines = source.split('\n');
  const patterns: [RegExp, string][] = [
    [/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, 'function'],
    [/^(?:export\s+)?(?:default\s+)?component\s+(\w+)/, 'component'],
    [/^(?:export\s+)?const\s+(\w+)/, 'variable'],
    [/^(?:export\s+)?let\s+(\w+)/, 'variable'],
    [/^(?:export\s+)?class\s+(\w+)/, 'class'],
    [/^(?:export\s+)?interface\s+(\w+)/, 'interface'],
    [/^(?:export\s+)?type\s+(\w+)/, 'type'],
  ];
  for (let i = 0; i < lines.length; i++) {
    for (const [re, kind] of patterns) {
      const match = lines[i].match(re);
      if (match) {
        decls.push({ name: match[1], line: i, column: lines[i].indexOf(match[1]), kind });
      }
    }
  }
  return decls;
}

function getVskComponents(source: string): ComponentInfo[] {
  const components: ComponentInfo[] = [];
  const lines = source.split('\n');
  const compRe = /(?:export\s+)?(?:default\s+)?component\s+(\w+)/;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(compRe);
    if (match) {
      const exported = /^export\s+/.test(lines[i].trim());
      const defaultExport = /^export\s+default\s+/.test(lines[i].trim());
      components.push({ name: match[1], line: i, column: lines[i].indexOf(match[1]), exported, defaultExport });
    }
  }
  return components;
}

function scanProject(root: string): ProjectIndex {
  const appDir = findAppDir(root);
  const files = new Map<string, ProjectFile>();
  const componentSources = new Map<string, string>();
  const { baseUrl, pathAliases } = loadTsconfig(root);

  // Scan routes for component→source mapping
  if (appDir) {
    try {
      const routeTree = scanRoutes(appDir);
      const sources = collectSources(routeTree);
      for (const [name, srcPath] of sources) {
        componentSources.set(name, srcPath);
      }
    } catch {}
  }

  // Scan external ./components dir
  const componentsDir = resolve(root, 'components');
  if (existsSync(componentsDir)) {
    try {
      const compMap = scanComponents(componentsDir);
      for (const [name, srcPath] of compMap) {
        componentSources.set(name, srcPath);
      }
    } catch {}
  }

  // Index all source files
  const allFiles = appDir ? walkDir(appDir) : [];
  allFiles.push(...walkDir(resolve(root, 'components')));
  allFiles.push(...walkDir(resolve(root, 'lib')));
  allFiles.push(...walkDir(resolve(root, 'src')));

  for (const filePath of allFiles) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      const ext = extname(filePath);
      const lang = ext === '.vsk' ? 'vsk' : ext;
      const exports = parseExports(source, lang);
      const components = lang === 'vsk' ? getVskComponents(source) : [];
      const declarations = parseDeclarations(source, lang);
      files.set(filePath, {
        uri: '',
        path: filePath,
        exports,
        components,
        declarations,
        lastModified: Date.now(),
      });
    } catch {}
  }

  return { workspaceRoot: root, appDir, baseUrl, pathAliases, files, componentSources, tailwindClasses: new Set(TAILWIND_CLASSES) };
}

function findFileByExportName(name: string): ProjectFile | undefined {
  for (const file of project.files.values()) {
    if (file.exports.some(e => e.name === name)) return file;
  }
  return undefined;
}

function findComponentSource(name: string): { path: string; line: number } | undefined {
  const srcPath = project.componentSources.get(name);
  if (srcPath && existsSync(srcPath)) {
    const source = readFileSync(srcPath, 'utf-8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`component ${name}`)) {
        return { path: srcPath, line: i };
      }
    }
  }
  return undefined;
}

function getWordRangeAtPosition(document: TextDocument, position: Position) {
  const text = document.getText();
  const offset = document.offsetAt(position);
  if (offset < 0 || offset >= text.length) return undefined;
  let start = offset;
  let end = offset;
  while (start > 0 && /\w/.test(text[start - 1])) start--;
  while (end < text.length && /\w/.test(text[end])) end++;
  if (start === end) return undefined;
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

function getWordAtPosition(document: TextDocument, position: Position): string {
  const range = getWordRangeAtPosition(document, position);
  if (!range) return '';
  return document.getText(range);
}

function isInClassAttribute(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  // Look backwards for class= or className=
  const before = text.substring(Math.max(0, offset - 200), offset);
  const classMatch = before.match(/(?:class|className)\s*=\s*["'`][^"'`]*$/);
  return classMatch !== null;
}

function isInAttributeValue(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 300), offset);
  const attrMatch = before.match(/(\w+)\s*=\s*["'`][^"'`]*$/);
  return attrMatch !== null;
}

function getOpeningTagName(document: TextDocument, position: Position): string | null {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 200), offset);
  const match = before.match(/<([A-Za-z_$@]\w*(?:[.-]\w+)*)([\s>][^>]*)?$/);
  if (!match) return null;
  return match[1];
}

function isSelfClosingTag(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 200), offset);
  return /<[^>]*\/\s*$/.test(before) || /<\w[\w.-]*\s+[^>]*\/\s*$/.test(before);
}

function isClosingTag(document: TextDocument, position: Position): boolean {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const before = text.substring(Math.max(0, offset - 200), offset);
  return /<\//.test(before) && !/<[^/]/.test(before.slice(before.lastIndexOf('<')));
}

function getJSDoc(source: string, line: number): string {
  const lines = source.split('\n');
  const commentLines: string[] = [];
  let i = line - 1;
  while (i >= 0) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('*')) {
      commentLines.unshift(trimmed.replace(/^\s*\*\s?/, ''));
    } else if (trimmed.startsWith('/**')) {
      commentLines.unshift(trimmed.replace(/^\s*\/\*\*\s?/, ''));
      break;
    } else if (trimmed.startsWith('//')) {
      commentLines.unshift(trimmed.replace(/^\s*\/\/\s?/, ''));
    } else if (trimmed === '' || trimmed.startsWith('import') || trimmed.startsWith('export')) {
      break;
    } else {
      break;
    }
    i--;
  }
  return commentLines.join('\n').replace(/\*\//g, '').trim();
}

function getJSDocForFile(filePath: string, symbolName: string): string | null {
  try {
    if (!existsSync(filePath)) return null;
    const source = readFileSync(filePath, 'utf-8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const re = new RegExp(`(?:component|function|const|let|var|class|interface|type)\\s+${symbolName}\\b`);
      if (re.test(lines[i])) {
        return getJSDoc(source, i) || null;
      }
    }
  } catch {}
  return null;
}

function makeImportEdit(document: TextDocument, names: string[], fromPath: string, isDefault: boolean = false): TextEdit | null {
  const source = document.getText();
  for (const name of names) {
    const importRe = new RegExp(`import\\s+[\\s\\S]*?\\b${name}\\b[\\s\\S]*?from\\s+['"]`);
    if (importRe.test(source)) return null;
  }
  const relPath = relative(dirname(document.uri.replace(/^file:\/\//, '')), fromPath);
  const importPath = relPath.startsWith('.') ? relPath : `./${relPath}`;
  const specifier = isDefault ? names[0] : `{ ${names.join(', ')} }`;
  const formatted = `import ${specifier} from '${importPath.replace(/\.(vsk|ts|tsx|js|jsx)$/, '')}';\n`;
  return TextEdit.insert({ line: 0, character: 0 }, formatted);
}

// ── LSP handlers ──────────────────────────────────────────────

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const rootUri = params.rootUri || params.rootPath || '';
  project.workspaceRoot = rootUri.replace(/^file:\/\//, '');
  try {
    project = scanProject(project.workspaceRoot);
    connection.console.log(`Vesk LSP: scanned ${project.files.size} files, ${project.componentSources.size} components`);
  } catch (e: any) {
    connection.console.error(`Vesk LSP scan error: ${e.message}`);
  }

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['<', '{', '/', '.', ' ', '"', "'", '`', 'c', 'e', 'i', 'l', 'f', 'w', 't', 's', '&', ':', '-'],
        resolveProvider: true,
      },
      hoverProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      semanticTokensProvider: {
        legend: {
          tokenTypes: ['component', 'reactive', 'keyword', 'function', 'variable', 'property', 'type', 'event'],
          tokenModifiers: ['declaration', 'definition', 'readonly', 'async'],
        },
        full: true,
      },
      foldingRangeProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: { prepareProvider: true },
      documentHighlightProvider: true,
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
      documentFormattingProvider: true,
      documentRangeFormattingProvider: true,
      documentOnTypeFormattingProvider: {
        firstTriggerCharacter: '>',
        moreTriggerCharacter: ['/', '\n'],
      },
      colorProvider: true,
      documentLinkProvider: { resolveProvider: false },
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      workspace: {
        fileOperations: {
          didCreate: { filters: [{ pattern: { glob: '**/*.{vsk,ts,tsx,js,jsx}' } }] },
          didDelete: { filters: [{ pattern: { glob: '**/*.{vsk,ts,tsx,js,jsx}' } }] },
        },
      },
    },
  };
});

connection.onDidChangeWatchedFiles(async (params: DidChangeWatchedFilesParams) => {
  for (const change of params.changes) {
    const path = change.uri.replace(/^file:\/\//, '');
    if (change.type === FileChangeType.Deleted) {
      project.files.delete(path);
    } else {
      try {
        if (existsSync(path) && /\.(vsk|ts|tsx|js|jsx)$/.test(path)) {
          const source = readFileSync(path, 'utf-8');
          const ext = extname(path);
          const lang = ext === '.vsk' ? 'vsk' : ext;
          const exports2 = parseExports(source, lang);
          const components2 = lang === 'vsk' ? getVskComponents(source) : [];
          const declarations2 = parseDeclarations(source, lang);
          project.files.set(path, { uri: '', path, exports: exports2, components: components2, declarations: declarations2, lastModified: Date.now() });
        }
      } catch {}
    }
  }
});

// ── Diagnostics ────────────────────────────────────────────────

documents.onDidChangeContent((change) => {
  validateDocument(change.document);
});

function validateDocument(document: TextDocument): void {
  const source = document.getText();
  const diagnostics: Diagnostic[] = [];
  const lines = source.split('\n');

  // Parse errors
  try {
    const ast = parse(source, {});
    if (ast && ast.body) {
      // Check for common issues
      const componentNames = new Set<string>();
      for (const node of ast.body) {
        let target: any = node;
        if (node.type === 'ExportNamedDeclaration' && node.declaration) target = node.declaration;
        if (node.type === 'ExportDefaultDeclaration' && node.declaration) target = node.declaration;
        if (target.type === 'ComponentDeclaration' && target.id) {
          if (componentNames.has(target.id.name)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Error,
              range: {
                start: { line: target.loc.start.line - 1, character: target.loc.start.column },
                end: { line: target.loc.end.line - 1, character: target.loc.end.column },
              },
              message: `Duplicate component name: '${target.id.name}'`,
              source: 'vesk',
            });
          }
          componentNames.add(target.id.name);
        }
      }
    }
  } catch (e: any) {
    const msg = e.message || String(e);
    const match = msg.match(/\((\d+):(\d+)\)/);
    if (match) {
      const line = parseInt(match[1]) - 1;
      const col = parseInt(match[2]) - 1;
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: {
          start: { line, character: col },
          end: { line, character: lines[line]?.length || col + 1 },
        },
        message: msg,
        source: 'vesk',
      });
    } else {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: lines[0]?.length || 1 } },
        message: msg,
        source: 'vesk',
      });
    }
  }

  // Unused imports warning
  const importRe = /import\s+(?:\{\s*([^}]+)\s*\}|(\w+))\s+from\s+['"][^'"]+['"]/g;
  let im: RegExpExecArray | null;
  while ((im = importRe.exec(source)) !== null) {
    const importedNames = (im[1] || im[2]).split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
    for (const name of importedNames) {
      if (!name) continue;
      // Check if name is used in the source outside of imports
      const usageRe = new RegExp(`\\b${name}\\b`);
      const allUsages = source.match(usageRe);
      if (allUsages && allUsages.length <= 1) {
        const from = im.index + im[0].indexOf(name);
        const to = from + name.length;
        const line = source.substring(0, from).split('\n').length - 1;
        const col = from - source.lastIndexOf('\n', from) - 1;
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: { start: { line, character: col }, end: { line, character: col + name.length } },
          message: `Unused import: '${name}'`,
          source: 'vesk',
        });
      }
    }
  }

  // Import validation: check that imported symbols are actually exported by the target
  const importAllRe = /import\s+(?:\{\s*([^}]+)\s*\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g;
  let im2: RegExpExecArray | null;
  while ((im2 = importAllRe.exec(source)) !== null) {
    const importedNames = (im2[1] || im2[2]).split(',').map(n => n.trim().split(/\s+as\s+/)[0].trim());
    const importPath = im2[3];
    if (!importPath.startsWith('.') && !importPath.startsWith('@')) continue;
    const resolvedFile = resolveImportPath(importPath, document.uri.replace(/^file:\/\//, ''), project);
    if (!resolvedFile || !existsSync(resolvedFile)) continue;
    const targetFile = project.files.get(resolvedFile);
    if (!targetFile) continue;
    for (const name of importedNames) {
      if (!name || name === '*') continue;
      const isExported = targetFile.exports.some(e => e.name === name);
      if (!isExported) {
        const from = im2.index + im2[0].indexOf(name);
        const line2 = source.substring(0, from).split('\n').length - 1;
        const col2 = from - source.lastIndexOf('\n', from) - 1;
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: { start: { line: line2, character: col2 }, end: { line: line2, character: col2 + name.length } },
          message: `'${name}' is not exported from '${importPath}'`,
          source: 'vesk',
        });
      }
    }
  }

  // Missing component / unknown JSX tag warning
  const jsxTagRe = /<([A-Z][a-zA-Z0-9_$]*)[\s/>]/g;
  let m: RegExpExecArray | null;
  while ((m = jsxTagRe.exec(source)) !== null) {
    const tagName = m[1];
    if (VESK_INTRINSICS.some(i => i.name === tagName)) continue;
    if (project.componentSources.has(tagName)) continue;
    if (findFileByExportName(tagName)) continue;
    const localDef = new RegExp(`component\\s+${tagName}\\b`).test(source);
    if (localDef) continue;
    const alreadyImported = new RegExp(`import\\s+[\\s\\S]*?\\b${tagName}\\b[\\s\\S]*?from\\s+['"]`).test(source);
    if (alreadyImported) continue;
    // Check if it's an HTML element used as uppercase (unusual but possible)
    if (HTML_ELEMENTS.includes(tagName.toLowerCase())) continue;

    const from = m.index + 1;
    const line = source.substring(0, from).split('\n').length - 1;
    const col = from - source.lastIndexOf('\n', from) - 1;
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: { start: { line, character: col }, end: { line, character: col + tagName.length } },
      message: `Unknown component '${tagName}' — neither imported nor defined locally`,
      source: 'vesk',
    });
  }

  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

// ── Completions ────────────────────────────────────────────────

connection.onCompletion(async (params: CompletionParams): Promise<CompletionItem[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const position = params.position;
  const source = document.getText();
  const offset = document.offsetAt(position);
  const linePrefix = source.substring(0, offset);
  const lastWord = linePrefix.match(/[a-zA-Z_$][\w$]*$/)?.[0] || '';
  const isComponentContext = /<\s*$/.test(linePrefix) || /<\s*[A-Za-z]*$/.test(linePrefix);
  const isClassAttr = isInClassAttribute(document, position);
  const isAttrValue = isInAttributeValue(document, position);

  const items: CompletionItem[] = [];

  // CSS completions inside <style> blocks
  if (isInsideStyleBlock(document, position)) {
    const { property, valuePrefix } = getCSSPrefix(document, position);
    if (property) {
      const propDef = CSS_PROPERTIES[property];
      if (propDef) {
        for (const val of propDef.values) {
          if (val.startsWith(valuePrefix)) {
            items.push({
              label: val,
              kind: CompletionItemKind.Value,
              detail: `CSS value — ${property}`,
              insertText: val.slice(valuePrefix.length),
            });
          }
        }
      }
      // Color values
      if (/color|background|border|outline|shadow/i.test(property)) {
        const colors = ['red', 'blue', 'green', 'white', 'black', 'gray', 'transparent', 'currentColor', 'inherit', '#000', '#fff', 'rgb(0,0,0)', 'rgba(0,0,0,1)'];
        for (const c of colors) {
          if (c.startsWith(valuePrefix)) {
            items.push({ label: c, kind: CompletionItemKind.Color, detail: `Color — ${property}` });
          }
        }
      }
    } else {
      const propNames = Object.keys(CSS_PROPERTIES);
      for (const prop of propNames) {
        if (prop.startsWith(valuePrefix)) {
          items.push({
            label: prop,
            kind: CompletionItemKind.Property,
            detail: CSS_PROPERTIES[prop].description,
            insertText: `${prop}: $0;`,
            insertTextFormat: InsertTextFormat.Snippet,
          });
        }
      }
    }
    return items;
  }

  // Tailwind classes in class="..." context
  if (isClassAttr) {
    for (const cls of project.tailwindClasses) {
      if (cls.startsWith(lastWord)) {
        items.push({
          label: cls,
          kind: CompletionItemKind.Value,
          detail: 'Tailwind CSS',
          insertText: cls.slice(lastWord.length),
        });
      }
    }
    return items;
  }

  // Vesk intrinsics
  if (!isAttrValue) {
    for (const intr of VESK_INTRINSICS) {
      if (intr.name.startsWith(lastWord)) {
        const isComponent = intr.kind === CompletionItemKind.Class;
        items.push({
          label: intr.name,
          kind: intr.kind,
          detail: intr.detail,
          documentation: { kind: MarkupKind.Markdown, value: intr.docs },
          insertText: intr.insertText,
          insertTextFormat: intr.insertText ? InsertTextFormat.Snippet : undefined,
        });
      }
    }
  }

  // Project components — only exported ones from other files
  if (isComponentContext || !isAttrValue) {
    const docUri = document.uri.replace(/^file:\/\//, '');
    for (const [name, srcPath] of project.componentSources) {
      if (!name.startsWith(lastWord)) continue;
      // Skip components from same file (they don't need import)
      if (srcPath === docUri) continue;
      // Check if component is actually exported from its source file
      const srcFile = project.files.get(srcPath);
      if (srcFile) {
        const comp = srcFile.components.find(c => c.name === name);
        if (!comp || !comp.exported) continue;
      }
      const importEdit = makeImportEdit(document, [name], srcPath);
      items.push({
        label: name,
        kind: CompletionItemKind.Class,
        detail: `Component — ${relative(project.workspaceRoot, srcPath)}`,
        additionalTextEdits: importEdit ? [importEdit] : undefined,
      });
    }
  }

  // File exports with auto-import — only from other files
  if (!isAttrValue) {
    const docUri = document.uri.replace(/^file:\/\//, '');
    for (const [filePath, file] of project.files) {
      if (filePath === docUri) continue; // skip current file
      for (const exp of file.exports) {
        if (!exp.name.startsWith(lastWord) || items.some(i => i.label === exp.name)) continue;
        const importEdit = makeImportEdit(document, [exp.name], filePath, exp.isDefault);
        items.push({
          label: exp.name,
          kind: CompletionItemKind.Variable,
          detail: `export from ${relative(project.workspaceRoot, filePath)}${exp.isDefault ? ' (default)' : ''}`,
          additionalTextEdits: importEdit ? [importEdit] : undefined,
        });
      }
    }
  }

  // Route paths (for Link/useNavigate completion)
  if (lastWord.startsWith('/') && !isAttrValue) {
    try {
      if (project.appDir) {
        const routes = scanRoutes(project.appDir);
        function addRoutePaths(nodes: any[], prefix: string) {
          for (const n of nodes) {
            const full = n.fullPath;
            if (full && full.startsWith(lastWord) && full !== '/') {
              items.push({
                label: full,
                kind: CompletionItemKind.Value,
                detail: 'Route',
              });
            }
            if (n.children) addRoutePaths(n.children, full);
          }
        }
        addRoutePaths(routes, '');
      }
    } catch {}
  }

  // HTML element completion in tag context
  if (isComponentContext || /<\s*[a-z]/i.test(linePrefix)) {
    for (const tag of HTML_ELEMENTS) {
      if (tag.startsWith(lastWord) && !items.some(i => i.label === tag)) {
        const isVoid = VOID_ELEMENTS.has(tag);
        items.push({
          label: tag,
          kind: CompletionItemKind.Property,
          detail: 'HTML element',
          insertText: isVoid ? `${tag}>` : `${tag}>$0</${tag}>`,
          insertTextFormat: InsertTextFormat.Snippet,
        });
      }
    }
  }

  return items;
});

connection.onCompletionResolve(async (item: CompletionItem): Promise<CompletionItem> => {
  return item;
});

// ── Hover ──────────────────────────────────────────────────────

connection.onHover(async (params: HoverParams): Promise<Hover | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const word = getWordAtPosition(document, params.position);
  if (!word) return null;

  const range = getWordRangeAtPosition(document, params.position);

  // Check Vesk intrinsics
  const intr = VESK_INTRINSICS.find(i => i.name === word);
  if (intr) {
    return {
      contents: { kind: MarkupKind.Markdown, value: `**${intr.name}**\n\n${intr.docs}\n\n---\n_Auto-imported from @vesk/runtime_` },
      range,
    };
  }

  // Check project components
  const srcPath = project.componentSources.get(word);
  if (srcPath && existsSync(srcPath)) {
    const rel = relative(project.workspaceRoot, srcPath);
    const source = readFileSync(srcPath, 'utf-8');
    const lines = source.split('\n');
    const compLine = lines.findIndex(l => l.includes(`component ${word}`));
    const signature = compLine >= 0 ? lines[compLine].trim() : word;
    const jsdoc = getJSDocForFile(srcPath, word);
    const doc = jsdoc ? `\n\n> ${jsdoc}` : '';
    return {
      contents: { kind: MarkupKind.Markdown, value: `**${word}**\n\n\`${signature}\`\n\n_Declared in \`${rel}:${compLine + 1}\`_${doc}` },
      range,
    };
  }

  // Check file exports
  const file = findFileByExportName(word);
  if (file) {
    const rel = relative(project.workspaceRoot, file.path);
    const expInfo = file.exports.find(e => e.name === word);
    const defaultLabel = expInfo?.isDefault ? ' (default)' : '';
    const jsdoc = getJSDocForFile(file.path, word);
    const doc = jsdoc ? `\n\n> ${jsdoc}` : '';
    return {
      contents: { kind: MarkupKind.Markdown, value: `**${word}**\n\nExported from \`${rel}\`${defaultLabel}${doc}` },
      range,
    };
  }

  // Check local declaration with JSDoc
  const localSource = document.getText();
  const localLines = localSource.split('\n');
  for (let i = 0; i < localLines.length; i++) {
    const re = new RegExp(`(?:component|function|const|let|var|class)\\s+${word}\\b`);
    if (re.test(localLines[i])) {
      const jsdoc = getJSDoc(localSource, i);
      const doc = jsdoc ? `\n\n> ${jsdoc}` : '';
      return {
        contents: { kind: MarkupKind.Markdown, value: `**${word}**${doc}` },
        range,
      };
    }
  }

  return null;
});

// ── Go to Definition ───────────────────────────────────────────

connection.onDefinition(async (params: DefinitionParams): Promise<Location | LocationLink[] | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const word = getWordAtPosition(document, params.position);
  if (!word) return null;

  // Check project components
  const srcPath = project.componentSources.get(word);
  if (srcPath && existsSync(srcPath)) {
    const source = readFileSync(srcPath, 'utf-8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`component ${word}`)) {
        return {
          uri: `file://${srcPath}`,
          range: {
            start: { line: i, character: lines[i].indexOf(word) },
            end: { line: i, character: lines[i].indexOf(word) + word.length },
          },
        };
      }
    }
  }

  // Check file exports — find from export declarations
  const file = findFileByExportName(word);
  if (file) {
    const expInfo = file.exports.find(e => e.name === word);
    if (expInfo) {
      return {
        uri: `file://${file.path}`,
        range: {
          start: { line: expInfo.line, character: expInfo.column },
          end: { line: expInfo.line, character: expInfo.column + word.length },
        },
      };
    }
    // Fallback: search source
    const source = readFileSync(file.path, 'utf-8');
    const lines = source.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(word) && /export/.test(lines[i])) {
        return {
          uri: `file://${file.path}`,
          range: {
            start: { line: i, character: lines[i].indexOf(word) },
            end: { line: i, character: lines[i].indexOf(word) + word.length },
          },
        };
      }
    }
  }

  // Check local declaration in current file
  const localSource = document.getText();
  const localLines = localSource.split('\n');
  for (let i = 0; i < localLines.length; i++) {
    if (localLines[i].includes(word) && /(?:component|function|const|let|var|class)\s+\w+/.test(localLines[i])) {
      const nameMatch = localLines[i].match(/(?:component|function|const|let|var|class)\s+(\w+)/);
      if (nameMatch && nameMatch[1] === word) {
        return {
          uri: params.textDocument.uri,
          range: {
            start: { line: i, character: localLines[i].indexOf(word) },
            end: { line: i, character: localLines[i].indexOf(word) + word.length },
          },
        };
      }
    }
  }

  return null;
});

// ── Find References ────────────────────────────────────────────

connection.onReferences(async (params: ReferenceParams): Promise<Location[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const word = getWordAtPosition(document, params.position);
  if (!word) return [];

  const locations: Location[] = [];
  const uri = params.textDocument.uri;

  // Search current document
  const source = document.getText();
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let idx = 0;
    while (true) {
      const pos = lines[i].indexOf(word, idx);
      if (pos === -1) break;
      locations.push({
        uri,
        range: { start: { line: i, character: pos }, end: { line: i, character: pos + word.length } },
      });
      idx = pos + 1;
    }
  }

  return locations;
});

// ── Document Highlights ────────────────────────────────────────

connection.onDocumentHighlight(async (params): Promise<DocumentHighlight[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const word = getWordAtPosition(document, params.position);
  if (!word) return [];

  const highlights: DocumentHighlight[] = [];
  const source = document.getText();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    let idx = 0;
    while (true) {
      const pos = lines[i].indexOf(word, idx);
      if (pos === -1) break;
      if (i === params.position.line && pos === params.position.character) {
        idx = pos + 1;
        continue;
      }
      highlights.push({
        range: { start: { line: i, character: pos }, end: { line: i, character: pos + word.length } },
        kind: DocumentHighlightKind.Text,
      });
      idx = pos + 1;
    }
  }

  return highlights;
});

// ── Rename ─────────────────────────────────────────────────────

connection.onPrepareRename(async (params: PrepareRenameParams): Promise<Range | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;
  const word = getWordAtPosition(document, params.position);
  if (!word) return null;
  return getWordRangeAtPosition(document, params.position) || null;
});

connection.onRenameRequest(async (params: RenameParams): Promise<WorkspaceEdit | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const word = getWordAtPosition(document, params.position);
  if (!word) return null;

  const changes: Record<string, TextEdit[]> = {};
  const allFiles = [params.textDocument.uri, ...Array.from(project.files.keys()).map(f => `file://${f}`)];

  for (const uri of allFiles) {
    try {
      const doc = uri === params.textDocument.uri ? document : documents.get(uri);
      let text: string;
      if (doc) {
        text = doc.getText();
      } else {
        const path = uri.replace(/^file:\/\//, '');
        if (!existsSync(path)) continue;
        text = readFileSync(path, 'utf-8');
      }

      const edits: TextEdit[] = [];
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        let idx = 0;
        while (true) {
          const pos = lines[i].indexOf(word, idx);
          if (pos === -1) break;
          edits.push({
            range: { start: { line: i, character: pos }, end: { line: i, character: pos + word.length } },
            newText: params.newName,
          });
          idx = pos + 1;
        }
      }
      if (edits.length > 0) {
        changes[uri] = edits;
      }
    } catch {}
  }

  return { changes };
});

// ── Document Symbols ───────────────────────────────────────────

connection.onDocumentSymbol(async (params): Promise<SymbolInformation[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const source = document.getText();
  const symbols: SymbolInformation[] = [];

  // Components
  const compRe = /(?:export\s+)?(?:default\s+)?component\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = compRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    symbols.push({
      name: m[1],
      kind: SymbolKind.Function,
      location: {
        uri: document.uri,
        range: {
          start: { line, character: m.index - source.lastIndexOf('\n', m.index) - 1 },
          end: { line: line + 1, character: 0 },
        },
      },
    });
  }

  // Functions
  const fnRe = /^export\s+(?:async\s+)?function\s+(\w+)/gm;
  while ((m = fnRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    symbols.push({
      name: m[1],
      kind: SymbolKind.Function,
      location: {
        uri: document.uri,
        range: {
          start: { line, character: m.index - source.lastIndexOf('\n', m.index) - 1 },
          end: { line: line + 1, character: 0 },
        },
      },
    });
  }

  return symbols;
});

// ── Workspace Symbols ───────────────────────────────────────────

connection.onWorkspaceSymbol(async (params): Promise<SymbolInformation[]> => {
  const query = params.query.toLowerCase();
  const symbols: SymbolInformation[] = [];

  for (const [filePath, file] of project.files) {
    try {
      const source = readFileSync(filePath, 'utf-8');
      const lines = source.split('\n');
      const uri = `file://${filePath}`;

      for (const comp of file.components) {
        if (comp.name.toLowerCase().includes(query)) {
          symbols.push({
            name: `${comp.name}${comp.exported ? '' : ' (private)'}`,
            kind: SymbolKind.Function,
            location: { uri, range: { start: { line: comp.line, character: comp.column }, end: { line: comp.line + 1, character: 0 } } },
          });
        }
      }

      for (const decl of file.declarations) {
        if (decl.name.toLowerCase().includes(query)) {
          symbols.push({ name: decl.name, kind: decl.kind === 'class' ? SymbolKind.Class : decl.kind === 'component' ? SymbolKind.Function : SymbolKind.Variable, location: { uri, range: { start: { line: decl.line, character: decl.column }, end: { line: decl.line + 1, character: 0 } } } });
        }
      }
    } catch {}
  }

  return symbols;
});

// ── Folding Ranges ─────────────────────────────────────────────

connection.onFoldingRanges(async (params: FoldingRangeParams): Promise<FoldingRange[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const source = document.getText();
  const ranges: FoldingRange[] = [];

  // Component bodies
  const compBodyRe = /(?:export\s+)?(?:default\s+)?component\s+\w+\s*(?:\([^)]*\))?\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = compBodyRe.exec(source)) !== null) {
    const startLine = source.substring(0, m.index).split('\n').length - 1;
    let braceCount = 1;
    let i = m.index + m[0].length;
    while (i < source.length && braceCount > 0) {
      if (source[i] === '{') braceCount++;
      else if (source[i] === '}') braceCount--;
      i++;
    }
    const endLine = source.substring(0, Math.min(i, source.length)).split('\n').length - 1;
    if (endLine > startLine + 1) {
      ranges.push({ startLine, endLine, kind: 'region' });
    }
  }

  // Import blocks
  const lines = source.split('\n');
  let importStart = -1;
  let importEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('import ')) {
      if (importStart === -1) importStart = i;
      importEnd = i;
    }
  }
  if (importStart >= 0 && importEnd > importStart) {
    ranges.push({ startLine: importStart, endLine: importEnd, kind: 'imports' });
  }

  return ranges;
});

// ── Document Links ──────────────────────────────────────────────

connection.onDocumentLinks(async (params: DocumentLinkParams): Promise<DocumentLink[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const source = document.getText();
  const links: DocumentLink[] = [];
  const importRe = /import\s+(?:\{[^}]*\}|[^'"]*)\s+from\s+['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  const docDir = dirname(document.uri.replace(/^file:\/\//, ''));

  while ((m = importRe.exec(source)) !== null) {
    const importPath = m[1];
    const from = m.index;
    const to = from + m[0].length;

    const docPath = document.uri.replace(/^file:\/\//, '');
    const resolved = resolveImportPath(importPath, docPath, project);

    if (resolved && existsSync(resolved)) {
      const linkRange: Range = { start: document.positionAt(from), end: document.positionAt(to) };
      links.push({ range: linkRange, target: `file://${resolved}` });
      continue;
    }

    // Handle @vesk/* imports via file index
    if (importPath.startsWith('@vesk/') && project.workspaceRoot) {
      const pkgName = importPath.split('/')[1];
      for (const [fp] of project.files) {
        if (fp.includes(`packages/${pkgName}`) && fp.endsWith('/index.js')) {
          const linkRange: Range = { start: document.positionAt(from), end: document.positionAt(to) };
          links.push({ range: linkRange, target: `file://${fp}` });
          break;
        }
      }
    }
  }

  return links;
});

// ── Semantic Tokens ─────────────────────────────────────────────

(connection.languages as any).semanticTokens.on(async (params: SemanticTokensParams): Promise<SemanticTokens> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return { data: [] };

  const source = document.getText();
  const lines = source.split('\n');
  const data: number[] = [];
  let prevLine = 0, prevChar = 0;

  function addToken(line: number, char: number, length: number, type: number, modifiers: number) {
    const deltaLine = line - prevLine;
    const deltaChar = deltaLine === 0 ? char - prevChar : char;
    data.push(deltaLine, deltaChar, length, type, modifiers);
    prevLine = line;
    prevChar = deltaLine === 0 ? char : char;
  }

  // Component declarations → type 0
  const compRe = /\b(?:export\s+)?(?:default\s+)?component\s+([A-Za-z_$]\w*)/g;
  let m: RegExpExecArray | null;
  while ((m = compRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    addToken(line, col, m[0].length, 0, m[0].startsWith('export') ? 3 : 0);
    // Tokenize the component name separately
    const nameLine = source.substring(0, m.index + m[1].length - 1).split('\n').length - 1;
    const nameCol = (m.index + m[0].indexOf(m[1])) - source.lastIndexOf('\n', m.index + m[0].indexOf(m[1])) - 1;
    addToken(nameLine, nameCol, m[1].length, 0, 1);
  }

  // Reactive declarations &[...] → type 1
  const reactiveRe = /&\[([\s\S]*?)\]/g;
  while ((m = reactiveRe.exec(source)) !== null) {
    const line = source.substring(0, m.index).split('\n').length - 1;
    const col = m.index - source.lastIndexOf('\n', m.index) - 1;
    addToken(line, col, m[0].length, 1, 0);
  }

  // Vesk keywords → type 3
  const keywords = ['track', 'effect', 'derived', 'root', 'get', 'set', 'slot', 'reconcile', 'redirect', 'permanentRedirect', 'notFound', 'useRouter', 'useNavigate', 'useParams', 'usePathname', 'useSearchParams', 'useFetch'];
  for (const kw of keywords) {
    const kwRe = new RegExp(`\\b${kw}\\b`, 'g');
    while ((m = kwRe.exec(source)) !== null) {
      const line = source.substring(0, m.index).split('\n').length - 1;
      const col = m.index - source.lastIndexOf('\n', m.index) - 1;
      addToken(line, col, m[0].length, 2, 0);
    }
  }

  // JSX intrinsic components → type 2
  const intrinsicNames = VESK_INTRINSICS.filter(i => i.kind === CompletionItemKind.Class).map(i => i.name);
  for (const name of intrinsicNames) {
    const tagRe = new RegExp(`<${name}([\\s/>])`, 'g');
    while ((m = tagRe.exec(source)) !== null) {
      const line = source.substring(0, m.index).split('\n').length - 1;
      const col = m.index - source.lastIndexOf('\n', m.index) - 1;
      addToken(line, col, name.length + 1, 2, 0);
    }
  }

  // CSS properties inside <style> → type 5
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
  while ((m = styleRe.exec(source)) !== null) {
    const styleText = m[1];
    const styleStart = m.index + m[0].indexOf(styleText);
    const propRe = /^(\s*)([\w-]+)\s*(?=:)/gm;
    let pm: RegExpExecArray | null;
    while ((pm = propRe.exec(styleText)) !== null) {
      const absOffset = styleStart + pm.index + pm[1].length;
      const line = source.substring(0, absOffset).split('\n').length - 1;
      const col = absOffset - source.lastIndexOf('\n', absOffset) - 1;
      addToken(line, col, pm[2].length, 5, 0);
    }
  }

  return { data };
});

// ── Signature Help ─────────────────────────────────────────────

connection.onSignatureHelp(async (params: SignatureHelpParams): Promise<SignatureHelp | null> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return null;

  const source = document.getText();
  const offset = document.offsetAt(params.position);
  const before = source.substring(Math.max(0, offset - 500), offset);

  // Check if inside a component call
  const compCall = before.match(/([A-Z]\w*)\s*\([^)]*$/);
  if (compCall) {
    const compName = compCall[1];
    const signatures: SignatureInformation[] = [];

    // Check if it's a known Vesk component
    const intr = VESK_INTRINSICS.find(i => i.name === compName && i.kind === CompletionItemKind.Class);
    if (intr) {
      signatures.push({
        label: `${compName}(props)`,
        documentation: { kind: MarkupKind.Markdown, value: intr.docs },
        parameters: [{ label: 'props', documentation: 'Component props object' }],
      });
    }

    // Check project components
    if (project.componentSources.has(compName)) {
      signatures.push({
        label: `${compName}(props)`,
        parameters: [{ label: 'props', documentation: 'Component props' }],
      });
    }

    if (signatures.length > 0) {
      const activeParam = before.match(/,/g)?.length || 0;
      return { signatures, activeSignature: 0, activeParameter: activeParam };
    }
  }

  return null;
});

// ── Code Actions ───────────────────────────────────────────────

connection.onCodeAction(async (params: CodeActionParams): Promise<CodeAction[]> => {
  const actions: CodeAction[] = [];
  const document = documents.get(params.textDocument.uri);
  if (!document) return actions;

  const source = document.getText();

  // Suggest wrapping JSX in <Head> for title/meta
  for (const diag of params.context.diagnostics) {
    if (diag.message.includes('title') || diag.message.includes('<title>')) {
      actions.push({
        title: 'Wrap in <Head> element',
        kind: CodeActionKind.QuickFix,
        edit: {
          changes: {
            [document.uri]: [TextEdit.insert(params.range.start, '<Head>\n  ')],
          },
        },
      });
    }
  }

  // Organize imports — sort and remove duplicates
  const importLines: { line: number; text: string }[] = [];
  const nonImportLines: { line: number; text: string }[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trimStart().startsWith('import ')) {
      importLines.push({ line: i, text: lines[i] });
    } else if (!importLines.length || nonImportLines.length > 0 || lines[i].trim()) {
      nonImportLines.push({ line: i, text: lines[i] });
    }
  }

  if (importLines.length > 0) {
    // Deduplicate imports
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const imp of importLines) {
      const key = imp.text.replace(/\s+/g, ' ').trim();
      if (!seen.has(key)) {
        seen.add(key);
        deduped.push(imp.text);
      }
    }
    deduped.sort();
    const organized = deduped.join('\n') + '\n\n';
    const importStart = importLines[0].line;
    const importEnd = importLines[importLines.length - 1].line;
    if (organized.trim() !== importLines.map(l => l.text).join('\n').trim()) {
      actions.push({
        title: 'Organize imports',
        kind: CodeActionKind.SourceOrganizeImports,
        edit: {
          changes: {
            [document.uri]: [TextEdit.replace({ start: { line: importStart, character: 0 }, end: { line: importEnd + 1, character: 0 } }, organized)],
          },
        },
      });
    }
  }

  return actions;
});

// ── Formatting ──────────────────────────────────────────────────

function formatVesk(source: string, indentSize: number = 2): string {
  const lines = source.split('\n');
  const result: string[] = [];
  let indent = 0;
  const indentStr = ' '.repeat(indentSize);

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) { result.push(''); continue; }

    const isStartBlock = /component\s+\w+|try\s*\{|catch\s*\(|else\s*\{|if\s*\(|for\s*\(|while\s*\(|switch\s*\(/.test(trimmed) && /\{$/.test(trimmed);
    const isEndBlock = /^\}/.test(trimmed);
    const isStartEnd = isStartBlock && isEndBlock;

    // Track indent changes
    if (isEndBlock && !isStartEnd) indent = Math.max(0, indent - 1);

    result.push(indentStr.repeat(indent) + trimmed);

    if (isStartBlock && !isStartEnd) indent++;
    else if (trimmed.endsWith('{') && !trimmed.includes('}')) indent++;
    else if (trimmed === '}') indent = Math.max(0, indent - 1);

    // Adjust indent for multi-line JSX
    const jsxOpenCount = (trimmed.match(/<[A-Za-z]/g) || []).length;
    const jsxCloseCount = (trimmed.match(/<\/[A-Za-z]/g) || []).length;
    indent += jsxOpenCount - jsxCloseCount;
    indent = Math.max(0, indent);
  }

  return result.join('\n');
}

connection.onDocumentFormatting(async (params: DocumentFormattingParams): Promise<TextEdit[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const source = document.getText();
  const formatted = formatVesk(source);
  if (formatted === source) return [];
  return [TextEdit.replace({ start: { line: 0, character: 0 }, end: { line: source.split('\n').length, character: 0 } }, formatted)];
});

connection.onDocumentRangeFormatting(async (params: DocumentRangeFormattingParams): Promise<TextEdit[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  const source = document.getText();
  const lines = source.split('\n');
  const startLine = params.range.start.line;
  const endLine = params.range.end.line;
  const selectedSource = lines.slice(startLine, endLine + 1).join('\n');
  const formatted = formatVesk(selectedSource);
  return [TextEdit.replace(params.range, formatted)];
});

// ── Color Provider ──────────────────────────────────────────────

const NAMED_COLORS: Record<string, [number, number, number]> = {
  red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255], white: [255, 255, 255],
  black: [0, 0, 0], gray: [128, 128, 128], yellow: [255, 255, 0], orange: [255, 165, 0],
  purple: [128, 0, 128], pink: [255, 192, 203], brown: [165, 42, 42], cyan: [0, 255, 255],
  magenta: [255, 0, 255], transparent: [0, 0, 0],
};

function parseCSSColorValue(value: string): Color | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) {
    const h = v.slice(1);
    if (h.length === 3) return { red: parseInt(h[0] + h[0], 16) / 255, green: parseInt(h[1] + h[1], 16) / 255, blue: parseInt(h[2] + h[2], 16) / 255, alpha: 1 };
    if (h.length === 6) return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255, alpha: 1 };
    if (h.length === 8) return { red: parseInt(h.slice(0, 2), 16) / 255, green: parseInt(h.slice(2, 4), 16) / 255, blue: parseInt(h.slice(4, 6), 16) / 255, alpha: parseInt(h.slice(6, 8), 16) / 255 };
  }
  const rgb = v.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) return { red: parseInt(rgb[1]) / 255, green: parseInt(rgb[2]) / 255, blue: parseInt(rgb[3]) / 255, alpha: 1 };
  const rgba = v.match(/^rgba\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/);
  if (rgba) return { red: parseInt(rgba[1]) / 255, green: parseInt(rgba[2]) / 255, blue: parseInt(rgba[3]) / 255, alpha: parseFloat(rgba[4]) };
  const hsl = v.match(/^hsl\s*\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)$/);
  if (hsl) {
    const h = parseInt(hsl[1]) / 360, s = parseInt(hsl[2]) / 100, l = parseInt(hsl[3]) / 100;
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h * 6) % 2 - 1)), m = l - c / 2;
    let r = 0, g = 0, b = 0;
    if (h < 1 / 6) { r = c; g = x; } else if (h < 2 / 6) { r = x; g = c; } else if (h < 3 / 6) { g = c; b = x; } else if (h < 4 / 6) { g = x; b = c; } else if (h < 5 / 6) { r = x; b = c; } else { r = c; b = x; }
    return { red: r + m, green: g + m, blue: b + m, alpha: 1 };
  }
  if (NAMED_COLORS[v]) {
    const [r, g, b] = NAMED_COLORS[v];
    return { red: r / 255, green: g / 255, blue: b / 255, alpha: v === 'transparent' ? 0 : 1 };
  }
  return null;
}

connection.onDocumentColor(async (params: DocumentColorParams): Promise<ColorInformation[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];

  const text = document.getText();
  const colors: ColorInformation[] = [];

  // Find <style> blocks
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g;
  let sm: RegExpExecArray | null;
  while ((sm = styleRe.exec(text)) !== null) {
    const cssText = sm[1];
    const styleOffset = sm.index + sm[0].indexOf(cssText);
    const colorRe = /(?:color|background(?:-color)?|border(?:-color)?|outline(?:-color)?)\s*:\s*([^;{}]+)/gi;
    let cm: RegExpExecArray | null;
    while ((cm = colorRe.exec(cssText)) !== null) {
      const val = cm[1].trim();
      const colorVal = parseCSSColorValue(val);
      if (colorVal) {
        const absOffset = styleOffset + cm.index + cm[0].indexOf(val);
        const startPos = document.positionAt(absOffset);
        const endPos = document.positionAt(absOffset + val.length);
        colors.push({ color: colorVal, range: { start: startPos, end: endPos } });
      }
    }

    // Also match standalone hex colors like #fff, #333
    const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
    let hm: RegExpExecArray | null;
    while ((hm = hexRe.exec(cssText)) !== null) {
      const colorVal = parseCSSColorValue(hm[0]);
      if (colorVal) {
        const absOffset = styleOffset + hm.index;
        const startPos = document.positionAt(absOffset);
        const endPos = document.positionAt(absOffset + hm[0].length);
        colors.push({ color: colorVal, range: { start: startPos, end: endPos } });
      }
    }
  }

  return colors;
});

connection.onColorPresentation(async (params: ColorPresentationParams): Promise<ColorPresentation[]> => {
  const c = params.color;
  const r = Math.round(c.red * 255), g = Math.round(c.green * 255), b = Math.round(c.blue * 255);
  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  return [
    { label: hex },
    { label: `rgb(${r}, ${g}, ${b})` },
    { label: `rgba(${r}, ${g}, ${b}, ${c.alpha.toFixed(2)})` },
  ];
});

// ── On-Type Formatting (tag auto-close) ─────────────────────────

connection.onDocumentOnTypeFormatting(async (params: DocumentOnTypeFormattingParams): Promise<TextEdit[]> => {
  const document = documents.get(params.textDocument.uri);
  if (!document || params.ch !== '>') return [];

  const tagName = getOpeningTagName(document, params.position);
  if (!tagName) return [];

  if (isSelfClosingTag(document, params.position)) return [];
  if (isClosingTag(document, params.position)) return [];
  if (VOID_ELEMENTS.has(tagName.toLowerCase())) return [];

  // Check if closing tag already exists ahead on same line
  const text = document.getText();
  const offset = document.offsetAt(params.position);
  const restOfLine = text.substring(offset, Math.min(offset + 200, text.length)).split('\n')[0];
  if (restOfLine.startsWith(`</${tagName}>`)) return [];

  const pos = params.position;
  const insertPos = { line: pos.line, character: pos.character + 1 };
  return [TextEdit.insert(insertPos, `</${tagName}>`)];
});

// ── Start ──────────────────────────────────────────────────────

documents.listen(connection);
connection.listen();
