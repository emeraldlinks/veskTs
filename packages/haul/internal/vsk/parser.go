package vsk

import (
	"fmt"
	"strings"
)

type Node interface {
	Pos() int
	End() int
}

// ---------- Program ----------

type Program struct {
	body  []Node
	start int
	end   int
}

func (p *Program) Pos() int     { return p.start }
func (p *Program) End() int     { return p.end }
func (p *Program) Body() []Node { return p.body }

// ---------- Imports / Exports ----------

type ImportDeclaration struct {
	source string
	start  int
	end    int
}

func (i *ImportDeclaration) Pos() int       { return i.start }
func (i *ImportDeclaration) End() int       { return i.end }
func (i *ImportDeclaration) Source() string { return i.source }

type ExportDeclaration struct {
	inner     Node
	isDefault bool
	start     int
	end       int
}

func (e *ExportDeclaration) Pos() int        { return e.start }
func (e *ExportDeclaration) End() int        { return e.end }
func (e *ExportDeclaration) Inner() Node     { return e.inner }
func (e *ExportDeclaration) IsDefault() bool { return e.isDefault }

// ---------- Components ----------

type Param struct {
	Name string
	Type string
}

type ComponentDeclaration struct {
	name   string
	params []Param
	client bool
	async  bool
	body   []Node
	style  *StyleBlock
	start  int
	end    int
}

func (c *ComponentDeclaration) Pos() int           { return c.start }
func (c *ComponentDeclaration) End() int           { return c.end }
func (c *ComponentDeclaration) Name() string       { return c.name }
func (c *ComponentDeclaration) Params() []Param    { return c.params }
func (c *ComponentDeclaration) Client() bool       { return c.client }
func (c *ComponentDeclaration) Async() bool        { return c.async }
func (c *ComponentDeclaration) Body() []Node       { return c.body }
func (c *ComponentDeclaration) Style() *StyleBlock { return c.style }

type StyleBlock struct {
	content string
	start   int
	end     int
}

func (s *StyleBlock) Pos() int { return s.start }
func (s *StyleBlock) End() int { return s.end }

// ---------- JSX ----------

type JSXElement struct {
	tagName  string
	attrs    []Attr
	children []Node
	start    int
	end      int
}

func (j *JSXElement) Pos() int         { return j.start }
func (j *JSXElement) End() int         { return j.end }
func (j *JSXElement) TagName() string  { return j.tagName }
func (j *JSXElement) Attrs() []Attr    { return j.attrs }
func (j *JSXElement) Children() []Node { return j.children }

type JSXFragment struct {
	children []Node
	start    int
	end      int
}

func (f *JSXFragment) Pos() int         { return f.start }
func (f *JSXFragment) End() int         { return f.end }
func (f *JSXFragment) Children() []Node { return f.children }

type Attr interface {
	AttrName() string
	AttrStart() int
	AttrEnd() int
}

type StaticAttribute struct {
	name  string
	value string
	start int
	end   int
}

func (a *StaticAttribute) AttrName() string { return a.name }
func (a *StaticAttribute) AttrStart() int   { return a.start }
func (a *StaticAttribute) AttrEnd() int     { return a.end }
func (a *StaticAttribute) Value() string    { return a.value }

type DynamicAttribute struct {
	name       string
	expression string
	start      int
	end        int
}

func (a *DynamicAttribute) AttrName() string   { return a.name }
func (a *DynamicAttribute) AttrStart() int     { return a.start }
func (a *DynamicAttribute) AttrEnd() int       { return a.end }
func (a *DynamicAttribute) Expression() string { return a.expression }

type BooleanAttribute struct {
	name  string
	start int
	end   int
}

func (a *BooleanAttribute) AttrName() string { return a.name }
func (a *BooleanAttribute) AttrStart() int   { return a.start }
func (a *BooleanAttribute) AttrEnd() int     { return a.end }

type SpreadAttribute struct {
	expression string
	start      int
	end        int
}

func (a *SpreadAttribute) AttrName() string   { return "" }
func (a *SpreadAttribute) AttrStart() int     { return a.start }
func (a *SpreadAttribute) AttrEnd() int       { return a.end }
func (a *SpreadAttribute) Expression() string { return a.expression }

type TextNode struct {
	content string
	start   int
	end     int
}

func (t *TextNode) Pos() int        { return t.start }
func (t *TextNode) End() int        { return t.end }
func (t *TextNode) Content() string { return t.content }

type ExpressionContainer struct {
	expression string
	start      int
	end        int
}

func (e *ExpressionContainer) Pos() int           { return e.start }
func (e *ExpressionContainer) End() int           { return e.end }
func (e *ExpressionContainer) Expression() string { return e.expression }

// ---------- Statements ----------

type TrackDecl struct {
	names       []string
	brace       byte
	initializer string
	start       int
	end         int
}

func (t *TrackDecl) Pos() int            { return t.start }
func (t *TrackDecl) End() int            { return t.end }
func (t *TrackDecl) Names() []string     { return t.names }
func (t *TrackDecl) Initializer() string { return t.initializer }

type ReturnStatement struct {
	value string
	start int
	end   int
}

func (r *ReturnStatement) Pos() int      { return r.start }
func (r *ReturnStatement) End() int      { return r.end }
func (r *ReturnStatement) Value() string { return r.value }

type RawStatement struct {
	text  string
	start int
	end   int
}

func (r *RawStatement) Pos() int { return r.start }
func (r *RawStatement) End() int { return r.end }

type IfBlock struct {
	condition  string
	consequent []Node
	alternate  []Node
	start      int
	end        int
}

func (i *IfBlock) Pos() int           { return i.start }
func (i *IfBlock) End() int           { return i.end }
func (i *IfBlock) Condition() string  { return i.condition }
func (i *IfBlock) Consequent() []Node { return i.consequent }
func (i *IfBlock) Alternate() []Node  { return i.alternate }

type ForBlock struct {
	header string
	body   []Node
	start  int
	end    int
}

func (f *ForBlock) Pos() int       { return f.start }
func (f *ForBlock) End() int       { return f.end }
func (f *ForBlock) Header() string { return f.header }
func (f *ForBlock) Body() []Node   { return f.body }

type WhileBlock struct {
	condition string
	body      []Node
	start     int
	end       int
}

func (w *WhileBlock) Pos() int          { return w.start }
func (w *WhileBlock) End() int          { return w.end }
func (w *WhileBlock) Condition() string { return w.condition }
func (w *WhileBlock) Body() []Node      { return w.body }

type SwitchBlock struct {
	expression string
	cases      []SwitchCase
	start      int
	end        int
}

func (s *SwitchBlock) Pos() int            { return s.start }
func (s *SwitchBlock) End() int            { return s.end }
func (s *SwitchBlock) Expression() string  { return s.expression }
func (s *SwitchBlock) Cases() []SwitchCase { return s.cases }

type SwitchCase struct {
	test      string
	isDefault bool
	body      []Node
	start     int
	end       int
}

func (c *SwitchCase) Test() string    { return c.test }
func (c *SwitchCase) IsDefault() bool { return c.isDefault }
func (c *SwitchCase) Body() []Node    { return c.body }

type TryBlock struct {
	tryBody    []Node
	catchParam string
	catchBody  []Node
	start      int
	end        int
}

func (t *TryBlock) Pos() int           { return t.start }
func (t *TryBlock) End() int           { return t.end }
func (t *TryBlock) TryBody() []Node    { return t.tryBody }
func (t *TryBlock) CatchParam() string { return t.catchParam }
func (t *TryBlock) CatchBody() []Node  { return t.catchBody }

type VeskBlock struct {
	tag      string
	children []Node
	start    int
	end      int
}

func (v *VeskBlock) Pos() int         { return v.start }
func (v *VeskBlock) End() int         { return v.end }
func (v *VeskBlock) Tag() string      { return v.tag }
func (v *VeskBlock) Children() []Node { return v.children }

// ---------- Parser ----------

type Parser struct {
	source string
	pos    int
}

func NewParser(source string) *Parser {
	source = strings.TrimPrefix(source, "\ufeff")
	return &Parser{source: source, pos: 0}
}

func Parse(source string) (*Program, error) {
	p := NewParser(source)
	p.skipWhitespace()
	var body []Node
	for p.pos < len(p.source) {
		node, err := p.parseTopLevel()
		if err != nil {
			return nil, err
		}
		if node != nil {
			body = append(body, node)
		}
		p.skipWhitespace()
	}
	return &Program{body: body, start: 0, end: len(source)}, nil
}

func (p *Parser) skipWhitespace() {
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		if ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			p.pos++
			continue
		}
		break
	}
}

func (p *Parser) skipLine() {
	for p.pos < len(p.source) && p.source[p.pos] != '\n' {
		p.pos++
	}
	if p.pos < len(p.source) {
		p.pos++
	}
}

// ---------- Top level ----------

func (p *Parser) parseTopLevel() (Node, error) {
	if p.matchKeyword("import") {
		return p.parseImport()
	}
	if p.matchKeyword("export") {
		return p.parseExport()
	}
	start := p.pos
	async := false
	if p.matchKeyword("async") {
		async = true
		p.pos += 5
		p.skipWhitespace()
	}
	if p.matchKeyword("component") {
		return p.parseComponent(async)
	}
	p.pos = start
	text, err := p.readStatementText()
	if err != nil {
		return nil, err
	}
	return &RawStatement{text: text, start: start, end: p.pos}, nil
}

func (p *Parser) parseImport() (*ImportDeclaration, error) {
	start := p.pos
	p.pos += len("import")
	p.skipWhitespace()
	var source string
	if p.match('"') || p.match('\'') || p.match('`') {
		s, err := p.readStringLiteral()
		if err != nil {
			return nil, err
		}
		source = s
		p.skipWhitespace()
		if p.match(';') {
			p.pos++
		}
		return &ImportDeclaration{source: source, start: start, end: p.pos}, nil
	}
	if p.matchKeyword("type") {
		p.pos += len("type")
		p.skipWhitespace()
	}
	if p.match('{') {
		if err := p.skipBalanced('{', '}'); err != nil {
			return nil, err
		}
		p.skipWhitespace()
	} else if p.match('*') {
		p.pos++
		p.skipWhitespace()
		if p.matchKeyword("as") {
			p.pos += len("as")
			p.skipWhitespace()
			if _, err := p.readIdentifier(); err != nil {
				return nil, err
			}
			p.skipWhitespace()
		}
	} else if isIdentStart(p.peek()) {
		if _, err := p.readIdentifier(); err != nil {
			return nil, err
		}
		p.skipWhitespace()
		if p.match(',') {
			p.pos++
			p.skipWhitespace()
			if p.match('{') {
				if err := p.skipBalanced('{', '}'); err != nil {
					return nil, err
				}
				p.skipWhitespace()
			}
		}
	}
	if p.matchKeyword("from") {
		p.pos += len("from")
		p.skipWhitespace()
		s, err := p.readStringLiteral()
		if err != nil {
			return nil, err
		}
		source = s
	}
	p.skipWhitespace()
	if p.match(';') {
		p.pos++
	}
	return &ImportDeclaration{source: source, start: start, end: p.pos}, nil
}

func (p *Parser) parseExport() (Node, error) {
	start := p.pos
	p.pos += len("export")
	p.skipWhitespace()
	isDefault := false
	if p.matchKeyword("default") {
		isDefault = true
		p.pos += len("default")
		p.skipWhitespace()
	}
	async := false
	if p.matchKeyword("async") {
		async = true
		p.pos += len("async")
		p.skipWhitespace()
	}
	if p.matchKeyword("component") {
		comp, err := p.parseComponent(async)
		if err != nil {
			return nil, err
		}
		return &ExportDeclaration{inner: comp, isDefault: isDefault, start: start, end: comp.end}, nil
	}
	text, err := p.readStatementText()
	if err != nil {
		return nil, err
	}
	return &ExportDeclaration{inner: &RawStatement{text: text, start: start, end: p.pos}, isDefault: isDefault, start: start, end: p.pos}, nil
}

// ---------- Components ----------

func (p *Parser) parseComponent(async bool) (*ComponentDeclaration, error) {
	start := p.pos
	p.pos += len("component")
	p.skipWhitespace()
	name, err := p.readIdentifier()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	if p.match('<') {
		if err := p.skipBalanced('<', '>'); err != nil {
			return nil, err
		}
		p.skipWhitespace()
	}
	var params []Param
	if p.match('(') {
		params, err = p.parseParams()
		if err != nil {
			return nil, err
		}
		p.skipWhitespace()
	}
	client := false
	if p.matchKeyword("client") {
		p.pos += len("client")
		client = true
		p.skipWhitespace()
	}
	if !p.match('{') {
		return nil, fmt.Errorf("expected '{' at %d", p.pos)
	}
	p.pos++
	body, err := p.parseBody(func() bool { return p.match('}') })
	if err != nil {
		return nil, err
	}
	if !p.match('}') {
		return nil, fmt.Errorf("expected '}' at %d", p.pos)
	}
	p.pos++
	var style *StyleBlock
	var rest []Node
	for _, n := range body {
		if s, ok := n.(*StyleBlock); ok {
			style = s
			continue
		}
		rest = append(rest, n)
	}
	return &ComponentDeclaration{name: name, params: params, client: client, async: async, body: rest, style: style, start: start, end: p.pos}, nil
}

func (p *Parser) parseParams() ([]Param, error) {
	inner, err := p.readParens()
	if err != nil {
		return nil, err
	}
	inner = strings.TrimSpace(inner)
	if inner == "" {
		return nil, nil
	}
	var params []Param
	for _, part := range splitTopLevel(inner, ',') {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		name := part
		var typ string
		if idx := findTopLevel(part, ':'); idx >= 0 {
			name = strings.TrimSpace(part[:idx])
			typ = strings.TrimSpace(part[idx+1:])
		}
		params = append(params, Param{Name: name, Type: typ})
	}
	return params, nil
}

func (p *Parser) parseStyle() (*StyleBlock, error) {
	start := p.pos
	p.pos += len("<style>")
	p.skipWhitespace()
	endIdx := strings.Index(p.source[p.pos:], "</style>")
	if endIdx == -1 {
		return nil, fmt.Errorf("unclosed style block at %d", start)
	}
	content := p.source[p.pos : p.pos+endIdx]
	p.pos += endIdx + len("</style>")
	return &StyleBlock{content: content, start: start, end: p.pos}, nil
}

// ---------- Body statements ----------

type stopFn func() bool

func (p *Parser) parseBody(stop stopFn) ([]Node, error) {
	var body []Node
	for {
		if p.pos >= len(p.source) {
			return nil, fmt.Errorf("unexpected end of input")
		}
		p.skipWhitespace()
		if p.pos >= len(p.source) {
			return nil, fmt.Errorf("unexpected end of input")
		}
		if stop() {
			return body, nil
		}
		if p.match(';') {
			p.pos++
			continue
		}
		node, err := p.parseStatement()
		if err != nil {
			return nil, err
		}
		if node != nil {
			body = append(body, node)
		}
	}
}

func (p *Parser) parseStatement() (Node, error) {
	if p.matchPrefix("{#") {
		return p.parseVeskBlock()
	}
	if p.matchPrefix("<style>") {
		return p.parseStyle()
	}
	if p.matchKeyword("let") || p.matchKeyword("const") {
		if p.trackDeclAhead() {
			return p.parseTrackDecl()
		}
		return p.parseRawStatement()
	}
	if p.matchKeyword("return") {
		return p.parseReturn()
	}
	if p.matchKeyword("if") {
		return p.parseIf()
	}
	if p.matchKeyword("for") {
		return p.parseFor()
	}
	if p.matchKeyword("while") {
		return p.parseWhile()
	}
	if p.matchKeyword("switch") {
		return p.parseSwitch()
	}
	if p.matchKeyword("try") {
		return p.parseTry()
	}
	if p.matchKeyword("empty") {
		if p.emptyBlockAhead() {
			return p.parseEmptyBlock()
		}
	}
	if p.matchKeyword("break") || p.matchKeyword("continue") || p.matchKeyword("throw") || p.matchKeyword("debugger") || p.matchKeyword("var") {
		return p.parseRawStatement()
	}
	if p.match('<') {
		return p.parseJSX()
	}
	if p.match('{') {
		return p.parseExpressionContainer()
	}
	textStart := p.pos
	text, err := p.readStatementText()
	if err != nil {
		return nil, err
	}
	if text != "" {
		return &RawStatement{text: text, start: textStart, end: p.pos}, nil
	}
	return nil, nil
}

func (p *Parser) parseRawStatement() (Node, error) {
	start := p.pos
	text, err := p.readStatementText()
	if err != nil {
		return nil, err
	}
	return &RawStatement{text: text, start: start, end: p.pos}, nil
}

func (p *Parser) trackDeclAhead() bool {
	save := p.pos
	defer func() { p.pos = save }()
	if p.matchKeyword("let") {
		p.pos += len("let")
	} else {
		p.pos += len("const")
	}
	p.skipWhitespace()
	return p.match('&')
}

func (p *Parser) parseTrackDecl() (*TrackDecl, error) {
	start := p.pos
	if p.matchKeyword("let") {
		p.pos += len("let")
	} else {
		p.pos += len("const")
	}
	p.skipWhitespace()
	if !p.match('&') {
		return nil, fmt.Errorf("expected '&' at %d", p.pos)
	}
	p.pos++
	p.skipWhitespace()
	open := p.peek()
	if open != '[' && open != '{' {
		return nil, fmt.Errorf("expected '[' or '{' after '&' at %d", p.pos)
	}
	p.pos++
	closeCh := byte(']')
	if open == '{' {
		closeCh = '}'
	}
	var names []string
	for {
		if p.pos >= len(p.source) {
			return nil, fmt.Errorf("unexpected end of input in track decl")
		}
		p.skipWhitespace()
		if p.match(closeCh) {
			break
		}
		if p.match(',') {
			p.pos++
			continue
		}
		name, err := p.readIdentifier()
		if err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	p.pos++
	p.skipWhitespace()
	if p.match(':') {
		p.pos++
		p.skipWhitespace()
		if _, err := p.scanUntilTopLevel('='); err != nil {
			return nil, err
		}
	}
	if !p.match('=') {
		return nil, fmt.Errorf("expected '=' in track decl at %d", p.pos)
	}
	p.pos++
	initText, err := p.readStatementText()
	if err != nil {
		return nil, err
	}
	return &TrackDecl{names: names, brace: open, initializer: initText, start: start, end: p.pos}, nil
}

func (p *Parser) parseReturn() (*ReturnStatement, error) {
	start := p.pos
	p.pos += len("return")
	p.skipWhitespace()
	if p.match('<') {
		jsxStart := p.pos
		jsx, err := p.parseJSX()
		if err != nil {
			return nil, err
		}
		value := strings.TrimSpace(p.source[jsxStart:jsx.End()])
		return &ReturnStatement{value: value, start: start, end: jsx.End()}, nil
	}
	text, err := p.readStatementText()
	if err != nil {
		return nil, err
	}
	return &ReturnStatement{value: text, start: start, end: p.pos}, nil
}

func (p *Parser) parseIf() (*IfBlock, error) {
	start := p.pos
	p.pos += len("if")
	p.skipWhitespace()
	cond, err := p.readParens()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	consequent, err := p.parseIfBody()
	if err != nil {
		return nil, err
	}
	var alternate []Node
	p.skipWhitespace()
	if p.matchKeyword("else") {
		p.pos += len("else")
		p.skipWhitespace()
		if p.matchKeyword("if") {
			altIf, err := p.parseIf()
			if err != nil {
				return nil, err
			}
			alternate = []Node{altIf}
		} else {
			alternate, err = p.parseIfBody()
			if err != nil {
				return nil, err
			}
		}
	}
	return &IfBlock{condition: cond, consequent: consequent, alternate: alternate, start: start, end: p.pos}, nil
}

func (p *Parser) parseIfBody() ([]Node, error) {
	if p.match('{') {
		return p.parseBracedBody()
	}
	stmt, err := p.parseStatement()
	if err != nil {
		return nil, err
	}
	if stmt == nil {
		return nil, nil
	}
	return []Node{stmt}, nil
}

func (p *Parser) parseFor() (*ForBlock, error) {
	start := p.pos
	p.pos += len("for")
	p.skipWhitespace()
	header, err := p.readParens()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	body, err := p.parseBracedBody()
	if err != nil {
		return nil, err
	}
	return &ForBlock{header: header, body: body, start: start, end: p.pos}, nil
}

func (p *Parser) parseWhile() (*WhileBlock, error) {
	start := p.pos
	p.pos += len("while")
	p.skipWhitespace()
	cond, err := p.readParens()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	body, err := p.parseBracedBody()
	if err != nil {
		return nil, err
	}
	return &WhileBlock{condition: cond, body: body, start: start, end: p.pos}, nil
}

func (p *Parser) parseSwitch() (*SwitchBlock, error) {
	start := p.pos
	p.pos += len("switch")
	p.skipWhitespace()
	expr, err := p.readParens()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	if !p.match('{') {
		return nil, fmt.Errorf("expected '{' after switch at %d", p.pos)
	}
	p.pos++
	var cases []SwitchCase
	for {
		p.skipWhitespace()
		if p.pos >= len(p.source) {
			return nil, fmt.Errorf("unclosed switch at %d", start)
		}
		if p.match('}') {
			p.pos++
			break
		}
		caseStart := p.pos
		var test string
		isDefault := false
		switch {
		case p.matchKeyword("case"):
			p.pos += len("case")
			p.skipWhitespace()
			t, err := p.readUntilTopLevel(':')
			if err != nil {
				return nil, err
			}
			test = t
		case p.matchKeyword("default"):
			p.pos += len("default")
			isDefault = true
			p.skipWhitespace()
			if !p.match(':') {
				return nil, fmt.Errorf("expected ':' after default at %d", p.pos)
			}
			p.pos++
		default:
			if _, err := p.readStatementText(); err != nil {
				return nil, err
			}
			continue
		}
		body, err := p.parseBody(func() bool {
			return p.match('}') || p.matchKeyword("case") || p.matchKeyword("default")
		})
		if err != nil {
			return nil, err
		}
		cases = append(cases, SwitchCase{test: test, isDefault: isDefault, body: body, start: caseStart, end: p.pos})
	}
	return &SwitchBlock{expression: expr, cases: cases, start: start, end: p.pos}, nil
}

func (p *Parser) parseTry() (*TryBlock, error) {
	start := p.pos
	p.pos += len("try")
	p.skipWhitespace()
	tryBody, err := p.parseBracedBody()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	if !p.matchKeyword("catch") {
		return nil, fmt.Errorf("expected catch after try at %d", start)
	}
	p.pos += len("catch")
	p.skipWhitespace()
	var catchParam string
	if p.match('(') {
		inner, err := p.readParens()
		if err != nil {
			return nil, err
		}
		catchParam = strings.TrimSpace(inner)
		p.skipWhitespace()
	}
	catchBody, err := p.parseBracedBody()
	if err != nil {
		return nil, err
	}
	return &TryBlock{tryBody: tryBody, catchParam: catchParam, catchBody: catchBody, start: start, end: p.pos}, nil
}

func (p *Parser) parseBracedBody() ([]Node, error) {
	if !p.match('{') {
		return nil, fmt.Errorf("expected '{' at %d", p.pos)
	}
	p.pos++
	body, err := p.parseBody(func() bool { return p.match('}') })
	if err != nil {
		return nil, err
	}
	if !p.match('}') {
		return nil, fmt.Errorf("expected '}' at %d", p.pos)
	}
	p.pos++
	return body, nil
}

func (p *Parser) parseVeskBlock() (*VeskBlock, error) {
	start := p.pos
	if !p.match('{') || p.pos+1 >= len(p.source) || p.source[p.pos+1] != '#' {
		return nil, fmt.Errorf("expected '{#' at %d", start)
	}
	p.pos += 2
	tag, err := p.readIdentifier()
	if err != nil {
		return nil, err
	}
	p.skipWhitespace()
	if !p.match('}') {
		return nil, fmt.Errorf("expected '}' after {#%s at %d", tag, start)
	}
	p.pos++
	closing := "{/" + tag + "}"
	children, err := p.parseBody(func() bool { return p.matchPrefix(closing) })
	if err != nil {
		return nil, err
	}
	if !p.matchPrefix(closing) {
		return nil, fmt.Errorf("unclosed {#%s block at %d", tag, start)
	}
	p.pos += len(closing)
	return &VeskBlock{tag: tag, children: children, start: start, end: p.pos}, nil
}

func (p *Parser) emptyBlockAhead() bool {
	save := p.pos
	defer func() { p.pos = save }()
	p.pos += len("empty")
	p.skipWhitespace()
	return p.match('{')
}

func (p *Parser) parseEmptyBlock() (*VeskBlock, error) {
	start := p.pos
	p.pos += len("empty")
	p.skipWhitespace()
	if !p.match('{') {
		return nil, fmt.Errorf("expected '{' after empty at %d", start)
	}
	p.pos++
	children, err := p.parseBody(func() bool { return p.match('}') })
	if err != nil {
		return nil, err
	}
	if !p.match('}') {
		return nil, fmt.Errorf("expected '}' at %d", p.pos)
	}
	p.pos++
	return &VeskBlock{tag: "empty", children: children, start: start, end: p.pos}, nil
}

func (p *Parser) parseExpressionContainer() (*ExpressionContainer, error) {
	start := p.pos
	p.pos++
	expr, err := p.readUntilTopLevel('}')
	if err != nil {
		return nil, err
	}
	return &ExpressionContainer{expression: expr, start: start, end: p.pos}, nil
}

// ---------- JSX ----------

func (p *Parser) parseJSX() (Node, error) {
	start := p.pos
	if !p.match('<') {
		return nil, fmt.Errorf("expected '<' at %d", start)
	}
	p.pos++
	if p.match('>') {
		p.pos++
		children, err := p.parseJSXChildren("</>")
		if err != nil {
			return nil, err
		}
		if !p.matchPrefix("</>") {
			return nil, fmt.Errorf("unclosed fragment at %d", start)
		}
		p.pos += 3
		return &JSXFragment{children: children, start: start, end: p.pos}, nil
	}
	name, err := p.readJSXName()
	if err != nil {
		return nil, err
	}
	var attrs []Attr
	for {
		p.skipWhitespace()
		if p.pos >= len(p.source) {
			return nil, fmt.Errorf("unclosed JSX tag %s at %d", name, start)
		}
		if p.match('>') || p.match('/') {
			break
		}
		if p.match('{') {
			spreadStart := p.pos
			p.pos++
			if p.matchPrefix("...") {
				p.pos += 3
				expr, err := p.readUntilTopLevel('}')
				if err != nil {
					return nil, err
				}
				attrs = append(attrs, &SpreadAttribute{expression: expr, start: spreadStart, end: p.pos})
				continue
			}
			return nil, fmt.Errorf("expected '...' in spread attribute at %d", spreadStart)
		}
		attrStart := p.pos
		attrName, err := p.readJSXName()
		if err != nil {
			return nil, err
		}
		p.skipWhitespace()
		if p.match('=') {
			p.pos++
			p.skipWhitespace()
			if p.match('{') {
				p.pos++
				expr, err := p.readUntilTopLevel('}')
				if err != nil {
					return nil, err
				}
				attrs = append(attrs, &DynamicAttribute{name: attrName, expression: expr, start: attrStart, end: p.pos})
				continue
			}
			val, err := p.readStringLiteral()
			if err != nil {
				return nil, err
			}
			attrs = append(attrs, &StaticAttribute{name: attrName, value: val, start: attrStart, end: p.pos})
			continue
		}
		attrs = append(attrs, &BooleanAttribute{name: attrName, start: attrStart, end: p.pos})
	}
	if p.match('/') {
		p.pos++
		if !p.match('>') {
			return nil, fmt.Errorf("expected '>' at %d", p.pos)
		}
		p.pos++
		return &JSXElement{tagName: name, attrs: attrs, start: start, end: p.pos}, nil
	}
	if !p.match('>') {
		return nil, fmt.Errorf("expected '>' at %d", p.pos)
	}
	p.pos++
	closePrefix := "</" + name + ">"
	children, err := p.parseJSXChildren(closePrefix)
	if err != nil {
		return nil, err
	}
	if !p.matchPrefix(closePrefix) {
		return nil, fmt.Errorf("unclosed JSX element %s at %d", name, start)
	}
	p.pos += len(closePrefix)
	return &JSXElement{tagName: name, attrs: attrs, children: children, start: start, end: p.pos}, nil
}

func (p *Parser) parseJSXChildren(closePrefix string) ([]Node, error) {
	var children []Node
	for {
		if p.matchPrefix(closePrefix) {
			return children, nil
		}
		if p.pos >= len(p.source) {
			return nil, fmt.Errorf("unclosed JSX: expected %s", closePrefix)
		}
		p.skipWhitespace()
		if p.matchPrefix(closePrefix) {
			return children, nil
		}
		if p.matchPrefix("{#") {
			block, err := p.parseVeskBlock()
			if err != nil {
				return nil, err
			}
			children = append(children, block)
			continue
		}
		if p.match('<') {
			jsx, err := p.parseJSX()
			if err != nil {
				return nil, err
			}
			children = append(children, jsx)
			continue
		}
		if p.match('{') {
			expr, err := p.parseExpressionContainer()
			if err != nil {
				return nil, err
			}
			children = append(children, expr)
			continue
		}
		textStart := p.pos
		text, err := p.readTextNode()
		if err != nil {
			return nil, err
		}
		if text != "" {
			children = append(children, &TextNode{content: text, start: textStart, end: p.pos})
		} else if p.pos >= len(p.source) {
			return nil, fmt.Errorf("unclosed JSX: expected %s", closePrefix)
		}
	}
}

// ---------- Character helpers ----------

func (p *Parser) readParens() (string, error) {
	if !p.match('(') {
		return "", fmt.Errorf("expected '(' at %d", p.pos)
	}
	start := p.pos
	depth := 0
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		switch ch {
		case '"', '\'', '`':
			p.skipString(ch)
			continue
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				inner := p.source[start+1 : p.pos]
				p.pos++
				return inner, nil
			}
		}
		p.pos++
	}
	return "", fmt.Errorf("unclosed '(' at %d", start)
}

func (p *Parser) readUntilTopLevel(stop byte) (string, error) {
	text, err := p.scanUntilTopLevel(stop)
	if err != nil {
		return "", err
	}
	p.pos++
	return text, nil
}

func (p *Parser) scanUntilTopLevel(stop byte) (string, error) {
	start := p.pos
	depth := 0
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		switch ch {
		case '"', '\'', '`':
			p.skipString(ch)
			continue
		case '(', '[', '{':
			depth++
		case ')', ']':
			depth--
			if depth < 0 {
				depth = 0
			}
		case '}':
			if ch == stop && depth == 0 {
				return p.source[start:p.pos], nil
			}
			depth--
			if depth < 0 {
				depth = 0
			}
		default:
			if ch == stop && depth == 0 {
				return p.source[start:p.pos], nil
			}
		}
		p.pos++
	}
	return "", fmt.Errorf("expected %q at %d", stop, start)
}

func (p *Parser) readStringLiteral() (string, error) {
	if p.pos >= len(p.source) {
		return "", fmt.Errorf("unexpected end of input")
	}
	quote := p.source[p.pos]
	if quote != '"' && quote != '\'' && quote != '`' {
		return "", fmt.Errorf("expected string literal at %d", p.pos)
	}
	p.pos++
	start := p.pos
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		if ch == '\\' {
			p.pos += 2
			continue
		}
		if ch == quote {
			val := p.source[start:p.pos]
			p.pos++
			return val, nil
		}
		p.pos++
	}
	return "", fmt.Errorf("unclosed string literal at %d", start)
}

func (p *Parser) skipString(quote byte) {
	p.pos++
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		if ch == '\\' {
			p.pos += 2
			continue
		}
		p.pos++
		if ch == quote {
			return
		}
	}
}

func (p *Parser) skipBalanced(open, close byte) error {
	if !p.match(open) {
		return fmt.Errorf("expected %q at %d", open, p.pos)
	}
	depth := 0
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		switch ch {
		case '"', '\'', '`':
			p.skipString(ch)
			continue
		case open:
			depth++
		case close:
			depth--
			if depth == 0 {
				p.pos++
				return nil
			}
		}
		p.pos++
	}
	return fmt.Errorf("unclosed %q at %d", open, p.pos)
}

func (p *Parser) readIdentifier() (string, error) {
	start := p.pos
	for p.pos < len(p.source) {
		if isIdentChar(p.source[p.pos]) {
			p.pos++
			continue
		}
		break
	}
	if start == p.pos {
		return "", fmt.Errorf("expected identifier at %d", p.pos)
	}
	return p.source[start:p.pos], nil
}

func (p *Parser) readJSXName() (string, error) {
	start := p.pos
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		if isIdentChar(ch) || ch == '.' || ch == ':' || ch == '-' {
			p.pos++
			continue
		}
		break
	}
	if start == p.pos {
		return "", fmt.Errorf("expected JSX tag name at %d", p.pos)
	}
	return p.source[start:p.pos], nil
}

func (p *Parser) readTextNode() (string, error) {
	start := p.pos
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		if ch == '<' || ch == '{' || ch == '}' {
			break
		}
		p.pos++
	}
	return strings.TrimSpace(p.source[start:p.pos]), nil
}

func (p *Parser) readStatementText() (string, error) {
	start := p.pos
	depth := 0
	for p.pos < len(p.source) {
		ch := p.source[p.pos]
		switch ch {
		case '"', '\'', '`':
			p.skipString(ch)
			continue
		case '{', '(', '[':
			depth++
		case '}', ')', ']':
			if depth == 0 && ch == '}' {
				return strings.TrimSpace(p.source[start:p.pos]), nil
			}
			depth--
		case '/':
			if p.matchPrefix("//") {
				for p.pos < len(p.source) && p.source[p.pos] != '\n' {
					p.pos++
				}
				continue
			}
		case ';':
			if depth == 0 {
				p.pos++
				return strings.TrimSpace(p.source[start:p.pos]), nil
			}
		case '\n':
			if depth == 0 {
				save := p.pos
				for p.pos < len(p.source) && isSpaceByte(p.source[p.pos]) {
					p.pos++
				}
				if p.pos >= len(p.source) || !isContinuationStart(p.peek()) {
					return strings.TrimSpace(p.source[start:save]), nil
				}
				continue
			}
		}
		p.pos++
	}
	return strings.TrimSpace(p.source[start:p.pos]), nil
}

func isSpaceByte(ch byte) bool {
	return ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n'
}

func isContinuationStart(ch byte) bool {
	switch ch {
	case '.', '[', '(', '`':
		return true
	}
	return false
}

func (p *Parser) matchKeyword(kw string) bool {
	if !strings.HasPrefix(p.source[p.pos:], kw) {
		return false
	}
	if p.pos+len(kw) < len(p.source) {
		ch := p.source[p.pos+len(kw)]
		if isIdentChar(ch) {
			return false
		}
	}
	return true
}

func (p *Parser) match(ch byte) bool {
	return p.pos < len(p.source) && p.source[p.pos] == ch
}

func (p *Parser) matchPrefix(prefix string) bool {
	return strings.HasPrefix(p.source[p.pos:], prefix)
}

func (p *Parser) peek() byte {
	if p.pos >= len(p.source) {
		return 0
	}
	return p.source[p.pos]
}

func (p *Parser) peekString(s string) bool {
	return strings.HasPrefix(p.source[p.pos:], s)
}

func isIdentChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_' || ch == '$'
}

func isIdentStart(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_' || ch == '$'
}

// ---------- Text helpers ----------

func splitTopLevel(s string, sep byte) []string {
	var parts []string
	depth := 0
	start := 0
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch ch {
		case '"', '\'', '`':
			q := ch
			i++
			for i < len(s) {
				if s[i] == '\\' {
					i++
				} else if s[i] == q {
					break
				}
				i++
			}
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		case sep:
			if depth == 0 {
				parts = append(parts, s[start:i])
				start = i + 1
			}
		}
	}
	parts = append(parts, s[start:])
	return parts
}

func findTopLevel(s string, target byte) int {
	depth := 0
	for i := 0; i < len(s); i++ {
		ch := s[i]
		switch ch {
		case '"', '\'', '`':
			q := ch
			i++
			for i < len(s) {
				if s[i] == '\\' {
					i++
				} else if s[i] == q {
					break
				}
				i++
			}
		case '(', '[', '{':
			depth++
		case ')', ']', '}':
			depth--
		case target:
			if depth == 0 {
				return i
			}
		}
	}
	return -1
}
