" Vesk syntax highlighting — full language support
" Based on Vesk tmLanguage grammar and LSP semantic token definitions

if exists('b:current_syntax') && b:current_syntax != 'vsk'
  finish
endif

syntax case match
syntax sync minlines=100

" ── Comments ────────────────────────────────────────────────────
syntax match vskLineComment /\/\/.*$/ display
syntax region vskBlockComment start="/\*" end="\*/" extend
syntax region vskJSXComment start="{!--" end="--}" display

" ── Strings ─────────────────────────────────────────────────────
syntax region vskStringDouble start=/"/ skip=/\\\\\|\\"\|\\n/ end=/"/ contains=vskEscape
syntax region vskStringSingle start=/'/ skip=/\\\\\|\\'\|\\n/ end=/'/ contains=vskEscape
syntax region vskStringTemplate start=/`/ skip=/\\\\\|\\`/ end=/`/ contains=vskEscape,vskTemplateExpr
syntax match vskEscape /\\[\\abfnrtv'"0-9xuU]/ contained

" Template expressions inside template literals
syntax region vskTemplateExpr matchgroup=vskTemplateDelimiter start=/\${/ end=/}/ contained
      \ contains=vskStringDouble,vskStringSingle,vskNumber,vskLineComment,vskBlockComment

" ── Numbers ─────────────────────────────────────────────────────
syntax match vskNumber /\<[0-9]\+\.[0-9]*\([eE][+-]\?[0-9]\+\)\?\>/
syntax match vskNumber /\<[0-9]\+\([eE][+-]\?[0-9]\+\)\?\>/
syntax match vskNumber /\<0[xX][0-9a-fA-F]\+\>/
syntax match vskNumber /\<0[bB][01]\+\>/
syntax match vskNumber /\<0[oO][0-7]\+\>/

" ── Component declarations ──────────────────────────────────────
" export [default] component Name(params) { ... }
syntax keyword vskExport export nextgroup=vskExportDefault skipwhite skipempty
syntax keyword vskExportDefault default nextgroup=vskExportDefault2 skipwhite skipempty
syntax keyword vskExportDefault2 default nextgroup=vskComponentKeyword contained skipwhite skipempty
syntax keyword vskComponentKeyword component nextgroup=vskCompName skipwhite skipempty
syntax match vskCompName /[A-Za-z_$][\w$]*/ contained nextgroup=vskCompFlags,vskCompParams skipwhite skipempty
syntax keyword vskCompFlags client async contained nextgroup=vskCompParams,vskCompBody skipwhite skipempty
syntax region vskCompParams matchgroup=vskParens start="(" end=")" contained
      \ contains=vskStringDouble,vskStringSingle,vskLineComment,vskBlockComment,vskType
syntax region vskCompBody matchgroup=vskCompBrace start="{" end="}" contained fold transparent

" ── Imports ─────────────────────────────────────────────────────
" import { ... } from '...'
syntax region vskImport start="\<import\>" end=/[;\n]/ keepend
      \ contains=vskImportKeyword,vskImportFrom,vskStringDouble,vskStringSingle,vskLineComment,vskImportNames
syntax keyword vskImportKeyword import contained nextgroup=vskImportNames skipwhite
syntax keyword vskImportFrom from contained
syntax match vskImportNames /{[^}]*}/ contained contains=vskImportName
syntax match vskImportName /\<[A-Za-z_$][\w$]*\>/ contained

" ── Control flow ────────────────────────────────────────────────
syntax keyword vskConditional if else switch case default
syntax keyword vskRepeat for while do
syntax keyword vskStatement return throw break continue try catch finally
syntax keyword vskAsync await async

" ── Storage types ───────────────────────────────────────────────
syntax keyword vskStorageType let const var function class import export
syntax keyword vskStorageType from of in

" ── Operators ───────────────────────────────────────────────────
syntax keyword vskOperator new typeof instanceof void delete
syntax match vskOperator /=>/
syntax match vskOperator /[+\-*/%]=/
syntax match vskOperator /++\|--/
syntax match vskOperator /===\|!==\|==\|!=/
syntax match vskOperator /<=\|>=\|<\|>/
syntax match vskOperator /&&\|||\|!/
syntax match vskOperator /?\s*\./
syntax match vskOperator /??/
syntax match vskOperator /?\./

" ── Language variables ──────────────────────────────────────────
syntax keyword vskLangVar this super arguments null undefined true false

" ── TypeScript type keywords ────────────────────────────────────
syntax keyword vskType string number boolean any void never unknown null undefined object symbol bigint
syntax keyword vskType Readonly Partial Required Pick Omit Record Exclude Extract NonNullable
syntax keyword vskType Promise Array Record ReturnType Parameters
syntax match vskTypeAnnotation /:\s*[A-Za-z_$][\w$]*/hs=s+1 contained contains=vskType

" ── Vesk intrinsics ────────────────────────────────────────────
syntax keyword vskIntrinsic track effect derived root get set slot reconcile
syntax keyword vskIntrinsic redirect permanentRedirect notFound
syntax keyword vskIntrinsic useRouter useNavigate useParams usePathname useSearchParams useFetch
syntax keyword vskIntrinsic Link NavLink Outlet Form Field
syntax keyword vskIntrinsic Image JsonLd Portal Head Experiment
syntax keyword vskIntrinsic required email minLength maxLength pattern custom

" ── Reactive declarations &[...] ────────────────────────────────
syntax region vskReactive matchgroup=vskReactiveDelimiter start=/&\[/ end=/\]/
      \ contains=vskStringDouble,vskStringSingle,vskNumber,vskLineComment,vskBlockComment

" ── JSX Tags (lowercase HTML elements) ──────────────────────────
syntax region vskJSXTag start=/<\/\?[a-z][a-zA-Z0-9_-]*\b/ end=/>/ keepend
      \ contains=vskJSTagName,vskJSXAttrib,vskJSXString,vskJSXExpr,vskJSXEvent,vskLineComment
syntax match vskJSTagName /<\/\?[a-z][a-zA-Z0-9_-]*/ contained
syntax match vskJSXAttrib /\<[a-zA-Z_$][\w$]*\ze\s*=\|\<class\|\<id\|\<href\|\<src\|\<alt\|\<title\|\<style\|\<rel\|\<type\>/ contained
syntax match vskJSXEvent /\<on[A-Z][a-zA-Z]*\ze\s*=/ contained
syntax region vskJSXString matchgroup=vskJSXQuote start=/"/ skip=/\\\\\|\\"/ end=/"/ contained
syntax region vskJSXString matchgroup=vskJSXQuote start=/'/ skip=/\\\\\|\\'/ end=/'/ contained
syntax region vskJSXExpr matchgroup=vskJSXBrace start="{" end="}" contained
      \ contains=vskStringDouble,vskStringSingle,vskNumber,vskLineComment,vskBlockComment,
      \           vskConditional,vskRepeat,vskStatement,vskStorageType,vskOperator,
      \           vskLangVar,vskType,vskIntrinsic,vskFunctionCall,vskPropAccess

" ── JSX Component Tags (uppercase) ──────────────────────────────
syntax region vskJSXCompTag start=/<\/\?[A-Z][a-zA-Z0-9_]*\b/ end=/>/ keepend
      \ contains=vskJSXCompName,vskJSXAttrib,vskJSXString,vskJSXExpr,vskJSXEvent
syntax match vskJSXCompName /<\/\?[A-Z][a-zA-Z0-9_]*/ contained

" ── Style blocks (embedded CSS) ─────────────────────────────────
syntax region vskStyleBlock matchgroup=vskStyleTag start=/<style\(>\|[^>]*>\)/ end=/<\/style>/ keepend
      \ contains=vskCSSSelector,vskCSSProp,vskCSSValue,vskCSSComment
syntax match vskCSSSelector /[.#a-zA-Z*][a-zA-Z0-9_#.\-: \[\]>+~]*\ze\s*{/ contained
syntax match vskCSSComment /\/\*.\{-}\*\// contained
syntax match vskCSSProp /[\w-]\+\ze\s*:/ contained
syntax match vskCSSValue /:\s*[^;{]*/hs=s+1 contained
syntax match vskCSSImportant /!\s*important/ contained

" ── Head blocks ─────────────────────────────────────────────────
syntax region vskHeadBlock matchgroup=vskHeadTag start=/<[Hh][Ee][Aa][Dd][^>]*>/ end=/<\/[Hh][Ee][Aa][Dd]>/ keepend
      \ contains=vskJSXTag,vskJSXCompTag,vskStringDouble,vskStringSingle

" ── Server/Client blocks ────────────────────────────────────────
syntax region vskServerBlock matchgroup=vskBlockTag start="{#server}" end="{\/server}" transparent
syntax region vskClientBlock matchgroup=vskBlockTag start="{#client}" end="{\/client}" transparent

" ── Function calls / property access ────────────────────────────
syntax match vskFunctionCall /\<[A-Za-z_$][\w$]*\ze(/
syntax match vskPropAccess /\.\s*[A-Za-z_$][\w$]*/hs=s+1

" ── Highlight links ─────────────────────────────────────────────
hi def link vskLineComment Comment
hi def link vskBlockComment Comment
hi def link vskJSXComment Comment
hi def link vskStringDouble String
hi def link vskStringSingle String
hi def link vskStringTemplate String
hi def link vskEscape SpecialChar
hi def link vskTemplateDelimiter Delimiter
hi def link vskNumber Number
hi def link vskExport Include
hi def link vskExportDefault Include
hi def link vskExportDefault2 Include
hi def link vskComponentKeyword Keyword
hi def link vskCompName Function
hi def link vskCompFlags StorageClass
hi def link vskCompBrace Delimiter
hi def link vskImportKeyword Include
hi def link vskImportFrom Include
hi def link vskImportName Identifier
hi def link vskConditional Conditional
hi def link vskRepeat Repeat
hi def link vskStatement Statement
hi def link vskAsync Keyword
hi def link vskStorageType StorageClass
hi def link vskOperator Operator
hi def link vskLangVar Constant
hi def link vskType Type
hi def link vskTypeAnnotation Type
hi def link vskIntrinsic Special
hi def link vskReactive Special
hi def link vskReactiveDelimiter Delimiter
hi def link vskJSTagName htmlTagName
hi def link vskJSXCompName Special
hi def link vskJSXAttrib Identifier
hi def link vskJSXEvent Special
hi def link vskJSXString String
hi def link vskJSXQuote htmlString
hi def link vskJSXBrace Delimiter
hi def link vskParens Delimiter
hi def link vskStyleTag htmlTag
hi def link vskCSSSelector Function
hi def link vskCSSProp Identifier
hi def link vskCSSValue String
hi def link vskCSSImportant Type
hi def link vskCSSComment Comment
hi def link vskHeadTag htmlTag
hi def link vskBlockTag PreProc
hi def link vskFunctionCall Function
hi def link vskPropAccess Identifier

let b:current_syntax = 'vsk'
