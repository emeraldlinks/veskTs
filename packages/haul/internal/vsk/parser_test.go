package vsk_test

import (
	"strings"
	"testing"

	"github.com/emeraldlinks/vesk/haul/internal/vsk"
)

func mustParse(t *testing.T, src string) *vsk.Program {
	t.Helper()
	prog, err := vsk.Parse(src)
	if err != nil {
		t.Fatalf("Parse failed: %v\nsource:\n%s", err, src)
	}
	if prog == nil {
		t.Fatalf("expected non-nil program")
	}
	return prog
}

func compOf(t *testing.T, prog *vsk.Program, idx int) *vsk.ComponentDeclaration {
	t.Helper()
	body := prog.Body()
	if idx >= len(body) {
		t.Fatalf("body has %d nodes, want index %d", len(body), idx)
	}
	switch n := body[idx].(type) {
	case *vsk.ComponentDeclaration:
		return n
	case *vsk.ExportDeclaration:
		if c, ok := n.Inner().(*vsk.ComponentDeclaration); ok {
			return c
		}
	}
	t.Fatalf("node %d is %T, want component", idx, body[idx])
	return nil
}

// ---------- imports / exports / top level ----------

func TestParseSimple(t *testing.T) {
	src := `import './global.css';
import { Button } from './Button.vsk';

export component App {
	<style>
		.app-wrapper { margin: 20px; }
	</style>
	<div class="app-wrapper">
		<Button label="Click me" />
		<div>Hello World</div>
	</div>
}`
	prog := mustParse(t, src)
	if len(prog.Body()) != 3 {
		t.Fatalf("expected 3 top-level nodes, got %d", len(prog.Body()))
	}
	if imp, ok := prog.Body()[1].(*vsk.ImportDeclaration); !ok {
		t.Fatalf("expected import, got %T", prog.Body()[1])
	} else if imp.Source() != "./Button.vsk" {
		t.Fatalf("expected source './Button.vsk', got %q", imp.Source())
	}
	comp := compOf(t, prog, 2)
	if comp.Name() != "App" {
		t.Fatalf("expected component name App, got %s", comp.Name())
	}
	if comp.Style() == nil {
		t.Fatal("expected style block")
	}
	if len(comp.Body()) != 1 {
		t.Fatalf("expected 1 body node (style extracted), got %d", len(comp.Body()))
	}
}

func TestImportVariants(t *testing.T) {
	cases := []struct {
		src    string
		source string
	}{
		{`import './global.css';`, "./global.css"},
		{`import { Button } from './Button.vsk';`, "./Button.vsk"},
		{`import Button from './Button.vsk';`, "./Button.vsk"},
		{`import { A, B as C } from './x.vsk'`, "./x.vsk"},
		{`import * as ns from './y';`, "./y"},
		{`import type { T } from './types';`, "./types"},
		{`import { type A, B } from './mix';`, "./mix"},
	}
	for _, c := range cases {
		prog := mustParse(t, c.src)
		if len(prog.Body()) != 1 {
			t.Fatalf("%q: expected 1 node, got %d", c.src, len(prog.Body()))
		}
		imp, ok := prog.Body()[0].(*vsk.ImportDeclaration)
		if !ok {
			t.Fatalf("%q: expected import, got %T", c.src, prog.Body()[0])
		}
		if imp.Source() != c.source {
			t.Fatalf("%q: expected source %q, got %q", c.src, c.source, imp.Source())
		}
	}
}

func TestTopLevelStatements(t *testing.T) {
	src := `
const helper = () => 42;
component App() {
	return <div>{helper()}</div>;
}
function other() { return 1; }
`
	prog := mustParse(t, src)
	if len(prog.Body()) != 3 {
		t.Fatalf("expected 3 top-level nodes, got %d", len(prog.Body()))
	}
	if _, ok := prog.Body()[0].(*vsk.RawStatement); !ok {
		t.Fatalf("expected raw statement for const, got %T", prog.Body()[0])
	}
	comp := compOf(t, prog, 1)
	if comp.Name() != "App" {
		t.Fatalf("expected App, got %s", comp.Name())
	}
	if _, ok := prog.Body()[2].(*vsk.RawStatement); !ok {
		t.Fatalf("expected raw statement for function, got %T", prog.Body()[2])
	}
}

// ---------- component declarations ----------

func TestExportVariants(t *testing.T) {
	cases := []struct {
		src       string
		name      string
		isDefault bool
		async     bool
	}{
		{`export component Name() { return <div/>; }`, "Name", false, false},
		{`export default component Name() { return <div/>; }`, "Name", true, false},
		{`export async component Name() { return <div/>; }`, "Name", false, true},
		{`export default async component Name() { return <div/>; }`, "Name", true, true},
		{`export default   component   Name()   { return <div/>; }`, "Name", true, false},
		{`export default\ncomponent Name() { return <div/>; }`, "Name", true, false},
	}
	for _, c := range cases {
		c.src = strings.ReplaceAll(c.src, `\n`, "\n")
		prog := mustParse(t, c.src)
		exp, ok := prog.Body()[0].(*vsk.ExportDeclaration)
		if !ok {
			t.Fatalf("%q: expected export, got %T", c.src, prog.Body()[0])
		}
		if exp.IsDefault() != c.isDefault {
			t.Fatalf("%q: isDefault=%v, want %v", c.src, exp.IsDefault(), c.isDefault)
		}
		comp := compOf(t, prog, 0)
		if comp.Name() != c.name {
			t.Fatalf("%q: name=%s, want %s", c.src, comp.Name(), c.name)
		}
		if comp.Async() != c.async {
			t.Fatalf("%q: async=%v, want %v", c.src, comp.Async(), c.async)
		}
	}
}

func TestAsyncComponentNoExport(t *testing.T) {
	prog := mustParse(t, `async component Child() {
		const data = await Promise.resolve([1, 2])
		<div>{data[0]}</div>
	}`)
	comp := compOf(t, prog, 0)
	if !comp.Async() {
		t.Fatal("expected async component")
	}
	if len(comp.Body()) != 2 {
		t.Fatalf("expected 2 body nodes (raw + jsx), got %d", len(comp.Body()))
	}
}

func TestClientKeyword(t *testing.T) {
	cases := []string{
		`component Counter() client { let &[count] = track(0); return <div>{count}</div>; }`,
		`export component Counter() client { return <div>X</div>; }`,
		`export default component App() client { return <div>X</div>; }`,
	}
	for _, src := range cases {
		comp := compOf(t, mustParse(t, src), 0)
		if !comp.Client() {
			t.Fatalf("%q: expected client=true", src)
		}
	}
	comp := compOf(t, mustParse(t, `component Static { return <div>Hi</div>; }`), 0)
	if comp.Client() {
		t.Fatal("expected client=false")
	}
}

func TestComponentParams(t *testing.T) {
	prog := mustParse(t, `component Counter(props: { initial: number }) {
		return <div>{props.initial}</div>;
	}`)
	comp := compOf(t, prog, 0)
	params := comp.Params()
	if len(params) != 1 {
		t.Fatalf("expected 1 param, got %d", len(params))
	}
	if params[0].Name != "props" {
		t.Fatalf("expected param name props, got %q", params[0].Name)
	}
	if !strings.Contains(params[0].Type, "initial") {
		t.Fatalf("expected type to mention initial, got %q", params[0].Type)
	}

	prog2 := mustParse(t, `component List<T>(props: { items: string[] }) { return <div/>; }`)
	_ = prog2

	prog3 := mustParse(t, `component Empty() { return <div/>; }`)
	if len(compOf(t, prog3, 0).Params()) != 0 {
		t.Fatal("expected no params")
	}
}

// ---------- track declarations ----------

func TestTrackDecl(t *testing.T) {
	cases := []struct {
		src         string
		names       []string
		initializer string
	}{
		{`let &[count] = track(0);`, []string{"count"}, "track(0);"},
		{`let &[count, rawCell] = track(0);`, []string{"count", "rawCell"}, "track(0);"},
		{`let &{x, y} = track({ x: 0, y: 0 });`, []string{"x", "y"}, "track({ x: 0, y: 0 });"},
		{`const &[count] = track(0);`, []string{"count"}, "track(0);"},
		{`let &[count]: number = track(0);`, []string{"count"}, "track(0);"},
		{`let &[filter] = track("all");`, []string{"filter"}, `track("all");`},
		{`let &[double] = track(() => count * 2);`, []string{"double"}, "track(() => count * 2);"},
	}
	for _, c := range cases {
		prog := mustParse(t, "component App() { "+c.src+" return <div/>; }")
		comp := compOf(t, prog, 0)
		body := comp.Body()
		if len(body) != 2 {
			t.Fatalf("%q: expected 2 body nodes, got %d", c.src, len(body))
		}
		tr, ok := body[0].(*vsk.TrackDecl)
		if !ok {
			t.Fatalf("%q: expected track decl, got %T", c.src, body[0])
		}
		if strings.Join(tr.Names(), ",") != strings.Join(c.names, ",") {
			t.Fatalf("%q: names=%v, want %v", c.src, tr.Names(), c.names)
		}
		if tr.Initializer() != c.initializer {
			t.Fatalf("%q: initializer=%q, want %q", c.src, tr.Initializer(), c.initializer)
		}
	}
}

func TestTrackDeclSemicolonless(t *testing.T) {
	prog := mustParse(t, `component App() {
		let &[count] = track(0)
		return <div>{count}</div>
	}`)
	comp := compOf(t, prog, 0)
	if len(comp.Body()) != 2 {
		t.Fatalf("expected 2 body nodes, got %d", len(comp.Body()))
	}
	if _, ok := comp.Body()[0].(*vsk.TrackDecl); !ok {
		t.Fatalf("expected track decl, got %T", comp.Body()[0])
	}
}

func TestRegularVariableCoexists(t *testing.T) {
	prog := mustParse(t, `component App() {
		const x = 42;
		let &[y] = track(0);
		return <div>{x + y}</div>;
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 3 {
		t.Fatalf("expected 3 body nodes, got %d", len(body))
	}
	if _, ok := body[0].(*vsk.RawStatement); !ok {
		t.Fatalf("expected raw statement for const x, got %T", body[0])
	}
	if _, ok := body[1].(*vsk.TrackDecl); !ok {
		t.Fatalf("expected track decl, got %T", body[1])
	}
}

// ---------- expression mode ----------

func TestExpressionMode(t *testing.T) {
	prog := mustParse(t, `component Counter(props: { initial: number }) {
		let &[count] = track(props.initial);
		return <div>{count}</div>;
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 2 {
		t.Fatalf("expected 2 body nodes, got %d", len(body))
	}
	ret, ok := body[1].(*vsk.ReturnStatement)
	if !ok {
		t.Fatalf("expected return statement, got %T", body[1])
	}
	if !strings.HasPrefix(ret.Value(), "<div>") {
		t.Fatalf("expected return value to be JSX, got %q", ret.Value())
	}
}

func TestReturnNullGuard(t *testing.T) {
	prog := mustParse(t, `component App(props: { show: boolean }) {
		if (!props.show) return null;
		<div>Visible</div>
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 2 {
		t.Fatalf("expected 2 body nodes, got %d", len(body))
	}
	guard, ok := body[0].(*vsk.IfBlock)
	if !ok {
		t.Fatalf("expected if block, got %T", body[0])
	}
	ret, ok := guard.Consequent()[0].(*vsk.ReturnStatement)
	if !ok {
		t.Fatalf("expected return in guard, got %T", guard.Consequent()[0])
	}
	if ret.Value() != "null;" && ret.Value() != "null" {
		t.Fatalf("expected return null, got %q", ret.Value())
	}
}

// ---------- statement mode ----------

func TestBareJSXStatement(t *testing.T) {
	prog := mustParse(t, `component App() {
		<div>Hello</div>
	}`)
	comp := compOf(t, prog, 0)
	if len(comp.Body()) != 1 {
		t.Fatalf("expected 1 body node, got %d", len(comp.Body()))
	}
	if _, ok := comp.Body()[0].(*vsk.JSXElement); !ok {
		t.Fatalf("expected JSX element, got %T", comp.Body()[0])
	}
}

func TestMultipleSiblingsAndNesting(t *testing.T) {
	prog := mustParse(t, `component App() {
		<div>
			<h1>Title</h1>
			<p>Content</p>
		</div>
		<footer>Footer</footer>
	}`)
	comp := compOf(t, prog, 0)
	if len(comp.Body()) != 2 {
		t.Fatalf("expected 2 body nodes, got %d", len(comp.Body()))
	}
	div, ok := comp.Body()[0].(*vsk.JSXElement)
	if !ok {
		t.Fatalf("expected div, got %T", comp.Body()[0])
	}
	if len(div.Children()) != 2 {
		t.Fatalf("expected 2 children, got %d", len(div.Children()))
	}
	if div.Children()[1].(*vsk.JSXElement).TagName() != "p" {
		t.Fatal("expected <p> child")
	}
}

func TestStatementModeMixed(t *testing.T) {
	prog := mustParse(t, `component TodoList(props: { todos: string[] }) {
		let &[filter] = track("all");
		let &[count] = track(0);
		if (props.todos.length === 0) return <EmptyState />;
		<div class="todo-list">
			<h2>Todos ({count})</h2>
			{filter === "all" && <p>Showing all</p>}
		</div>
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 4 {
		t.Fatalf("expected 4 body nodes, got %d", len(body))
	}
	if _, ok := body[0].(*vsk.TrackDecl); !ok {
		t.Fatalf("expected track, got %T", body[0])
	}
	if _, ok := body[2].(*vsk.IfBlock); !ok {
		t.Fatalf("expected guard if, got %T", body[2])
	}
	div, ok := body[3].(*vsk.JSXElement)
	if !ok {
		t.Fatalf("expected div, got %T", body[3])
	}
	if len(div.Children()) != 2 {
		t.Fatalf("expected 2 div children, got %d", len(div.Children()))
	}
	divContainers := 0
	for _, child := range div.Children() {
		if _, ok := child.(*vsk.ExpressionContainer); ok {
			divContainers++
		}
	}
	if divContainers != 1 {
		t.Fatalf("expected 1 expression container in div, got %d", divContainers)
	}
	h2, ok := div.Children()[0].(*vsk.JSXElement)
	if !ok {
		t.Fatalf("expected h2 child, got %T", div.Children()[0])
	}
	h2Containers := 0
	for _, child := range h2.Children() {
		if _, ok := child.(*vsk.ExpressionContainer); ok {
			h2Containers++
		}
	}
	if h2Containers != 1 {
		t.Fatalf("expected 1 expression container in h2 (count), got %d", h2Containers)
	}
}

func TestSemicolonlessExpressionStatements(t *testing.T) {
	prog := mustParse(t, `component App() {
		foo()
		foo(1, 2)
		x = 5
		x++
		x--
		--x
		let &[count] = track(0)
		count++
		<div>{count}</div>
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 9 {
		t.Fatalf("expected 9 body nodes, got %d", len(body))
	}
	if _, ok := body[8].(*vsk.JSXElement); !ok {
		t.Fatalf("expected JSX last, got %T", body[8])
	}
	for i := 0; i < 8; i++ {
		if i == 6 {
			if _, ok := body[i].(*vsk.TrackDecl); !ok {
				t.Fatalf("expected track at %d, got %T", i, body[i])
			}
		} else if _, ok := body[i].(*vsk.RawStatement); !ok {
			t.Fatalf("expected raw statement at %d, got %T", i, body[i])
		}
	}
}

// ---------- JSX attributes ----------

func TestJSXAttributes(t *testing.T) {
	prog := mustParse(t, `component App(props: { n: number }) {
		<Button label="Click me" count={props.n} disabled {...props} />
	}`)
	comp := compOf(t, prog, 0)
	btn, ok := comp.Body()[0].(*vsk.JSXElement)
	if !ok {
		t.Fatalf("expected Button, got %T", comp.Body()[0])
	}
	if btn.TagName() != "Button" {
		t.Fatalf("expected tag Button, got %s", btn.TagName())
	}
	attrs := btn.Attrs()
	if len(attrs) != 4 {
		t.Fatalf("expected 4 attrs, got %d", len(attrs))
	}
	kinds := map[string]bool{}
	for _, a := range attrs {
		switch v := a.(type) {
		case *vsk.StaticAttribute:
			kinds["static"] = true
			if v.AttrName() != "label" || v.Value() != "Click me" {
				t.Fatalf("bad static attr: %+v", v)
			}
		case *vsk.DynamicAttribute:
			kinds["dynamic"] = true
			if v.AttrName() != "count" || strings.TrimSpace(v.Expression()) != "props.n" {
				t.Fatalf("bad dynamic attr: %+v", v)
			}
		case *vsk.BooleanAttribute:
			kinds["boolean"] = true
			if v.AttrName() != "disabled" {
				t.Fatalf("bad boolean attr: %+v", v)
			}
		case *vsk.SpreadAttribute:
			kinds["spread"] = true
			if strings.TrimSpace(v.Expression()) != "props" {
				t.Fatalf("bad spread attr: %+v", v)
			}
		default:
			t.Fatalf("unexpected attr type %T", a)
		}
	}
	for k, ok := range kinds {
		if !ok {
			t.Fatalf("missing attr kind %s", k)
		}
	}
}

func TestJSXFragments(t *testing.T) {
	prog := mustParse(t, `component App() {
		<>
			<h1>One</h1>
			<h2>Two</h2>
		</>
	}`)
	comp := compOf(t, prog, 0)
	frag, ok := comp.Body()[0].(*vsk.JSXFragment)
	if !ok {
		t.Fatalf("expected fragment, got %T", comp.Body()[0])
	}
	if len(frag.Children()) != 2 {
		t.Fatalf("expected 2 fragment children, got %d", len(frag.Children()))
	}
}

func TestExpressionContainerWithJSX(t *testing.T) {
	prog := mustParse(t, `component App(props: { show: boolean; items: string[] }) {
		<div>
			{props.show && <span>Visible</span>}
			{props.items.map((item) => (<li key={item}>{item}</li>))}
		</div>
	}`)
	comp := compOf(t, prog, 0)
	div := comp.Body()[0].(*vsk.JSXElement)
	var containers []*vsk.ExpressionContainer
	for _, child := range div.Children() {
		if e, ok := child.(*vsk.ExpressionContainer); ok {
			containers = append(containers, e)
		}
	}
	if len(containers) != 2 {
		t.Fatalf("expected 2 expression containers, got %d", len(containers))
	}
	if !strings.Contains(containers[0].Expression(), "&&") {
		t.Fatalf("expected && expr, got %q", containers[0].Expression())
	}
	if !strings.Contains(containers[1].Expression(), "map") {
		t.Fatalf("expected map expr, got %q", containers[1].Expression())
	}
}

// ---------- statement-mode blocks ----------

func TestJSXChildrenStatementKeywordIsText(t *testing.T) {
	prog := mustParse(t, `component App() {
		<h2 class="mt-6">if / else</h2>
		<p>for real? while we wait.</p>
		<code>; key todo.id</code>
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 3 {
		t.Fatalf("expected 3 body nodes, got %d", len(body))
	}
	want := []struct {
		tag  string
		text string
	}{
		{"h2", "if / else"},
		{"p", "for real? while we wait."},
		{"code", "; key todo.id"},
	}
	for i, w := range want {
		el, ok := body[i].(*vsk.JSXElement)
		if !ok {
			t.Fatalf("body[%d]: expected %s element, got %T", i, w.tag, body[i])
		}
		if el.TagName() != w.tag {
			t.Fatalf("body[%d]: expected tag %s, got %s", i, w.tag, el.TagName())
		}
		children := el.Children()
		if len(children) != 1 {
			t.Fatalf("%s: expected 1 text child, got %d", w.tag, len(children))
		}
		txt, ok := children[0].(*vsk.TextNode)
		if !ok {
			t.Fatalf("%s: expected text node, got %T", w.tag, children[0])
		}
		if txt.Content() != w.text {
			t.Fatalf("%s: expected text %q, got %q", w.tag, w.text, txt.Content())
		}
	}
}

func TestTextModeForOfInJSXChildren(t *testing.T) {
	prog := mustParse(t, `component App(props: { todos: { id: number, text: string }[] }) {
		<ul class="space-y-2">
			for (const todo of props.todos; key todo.id) {
				<li>{todo.text}</li>
			}
			#empty {
				<li>No todos yet</li>
			}
		</ul>
	}`)
	comp := compOf(t, prog, 0)
	ul, ok := comp.Body()[0].(*vsk.JSXElement)
	if !ok {
		t.Fatalf("expected ul, got %T", comp.Body()[0])
	}
	children := ul.Children()
	var texts []*vsk.TextNode
	var containers []*vsk.ExpressionContainer
	for _, c := range children {
		switch n := c.(type) {
		case *vsk.TextNode:
			texts = append(texts, n)
		case *vsk.ExpressionContainer:
			containers = append(containers, n)
		case *vsk.JSXElement:
			t.Fatalf("unexpected nested element in ul children: %s", n.TagName())
		}
	}
	if len(texts) != 2 {
		t.Fatalf("expected 2 text nodes, got %d", len(texts))
	}
	if texts[0].Content() != "for (const todo of props.todos; key todo.id)" {
		t.Fatalf("expected for text, got %q", texts[0].Content())
	}
	if texts[1].Content() != "#empty" {
		t.Fatalf("expected #empty text, got %q", texts[1].Content())
	}
	if len(containers) != 2 {
		t.Fatalf("expected 2 expression containers, got %d", len(containers))
	}
	if !strings.Contains(containers[0].Expression(), "<li>") {
		t.Fatalf("expected li in container[0], got %q", containers[0].Expression())
	}
	if !strings.Contains(containers[1].Expression(), "<li>") {
		t.Fatalf("expected li in container[1], got %q", containers[1].Expression())
	}
}

func TestForThenEmptyBlockAtStatementLevel(t *testing.T) {
	prog := mustParse(t, `component App(props: { todos: string[] }) {
		for (const todo of props.todos; key todo.id) {
			<li>{todo}</li>
		}
		empty {
			<li>None</li>
		}
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 2 {
		t.Fatalf("expected 2 body nodes, got %d", len(body))
	}
	fb, ok := body[0].(*vsk.ForBlock)
	if !ok {
		t.Fatalf("expected for block, got %T", body[0])
	}
	if fb.Header() != "const todo of props.todos; key todo.id" {
		t.Fatalf("unexpected for header %q", fb.Header())
	}
	eb, ok := body[1].(*vsk.VeskBlock)
	if !ok {
		t.Fatalf("expected empty block, got %T", body[1])
	}
	if eb.Tag() != "empty" {
		t.Fatalf("expected tag empty, got %q", eb.Tag())
	}
}

func TestIfElse(t *testing.T) {
	prog := mustParse(t, `component App(props: { x: number }) {
		if (x > 0) {
			<p>Positive</p>
		} else {
			<p>Negative</p>
		}
	}`)
	comp := compOf(t, prog, 0)
	ifb, ok := comp.Body()[0].(*vsk.IfBlock)
	if !ok {
		t.Fatalf("expected if block, got %T", comp.Body()[0])
	}
	if len(ifb.Consequent()) != 1 {
		t.Fatalf("expected 1 consequent node, got %d", len(ifb.Consequent()))
	}
	if len(ifb.Alternate()) != 1 {
		t.Fatalf("expected 1 alternate node, got %d", len(ifb.Alternate()))
	}
}

func TestIfElseIfChain(t *testing.T) {
	prog := mustParse(t, `component App(props: { x: number }) {
		if (x > 0) {
			<p>A</p>
		} else if (x < 0) {
			<p>B</p>
		} else {
			<p>C</p>
		}
	}`)
	comp := compOf(t, prog, 0)
	ifb := comp.Body()[0].(*vsk.IfBlock)
	if len(ifb.Alternate()) != 1 {
		t.Fatalf("expected nested if in alternate, got %d nodes", len(ifb.Alternate()))
	}
	if _, ok := ifb.Alternate()[0].(*vsk.IfBlock); !ok {
		t.Fatalf("expected nested if, got %T", ifb.Alternate()[0])
	}
}

func TestGuardClauses(t *testing.T) {
	prog := mustParse(t, `component App(props: { loading: boolean; error: string | null }) {
		if (props.loading) return <Spinner />;
		if (props.error) return <Error message={props.error} />;
		return <div>ok</div>;
	}`)
	comp := compOf(t, prog, 0)
	body := comp.Body()
	if len(body) != 3 {
		t.Fatalf("expected 3 body nodes, got %d", len(body))
	}
	for i := 0; i < 2; i++ {
		ifb, ok := body[i].(*vsk.IfBlock)
		if !ok {
			t.Fatalf("expected guard if at %d, got %T", i, body[i])
		}
		if len(ifb.Consequent()) != 1 {
			t.Fatalf("expected single-statement consequent, got %d", len(ifb.Consequent()))
		}
		if _, ok := ifb.Consequent()[0].(*vsk.ReturnStatement); !ok {
			t.Fatalf("expected return in guard, got %T", ifb.Consequent()[0])
		}
	}
	if _, ok := body[2].(*vsk.ReturnStatement); !ok {
		t.Fatalf("expected final return, got %T", body[2])
	}
}

func TestForLoops(t *testing.T) {
	prog := mustParse(t, `component List(props: { items: string[] }) {
		for (let i = 0; i < 5; i++) {
			<li>{i}</li>
		}
		for (const todo of props.items; key todo.id; index i) {
			<li>{todo.text}</li>
		}
	}`)
	comp := compOf(t, prog, 0)
	if len(comp.Body()) != 2 {
		t.Fatalf("expected 2 loops, got %d", len(comp.Body()))
	}
	first, ok := comp.Body()[0].(*vsk.ForBlock)
	if !ok {
		t.Fatalf("expected for block, got %T", comp.Body()[0])
	}
	if !strings.Contains(first.Header(), "i < 5") {
		t.Fatalf("bad for header %q", first.Header())
	}
	second := comp.Body()[1].(*vsk.ForBlock)
	if !strings.Contains(second.Header(), "todo of props.items; key todo.id; index i") {
		t.Fatalf("bad keyed for-of header %q", second.Header())
	}
}

func TestWhileLoop(t *testing.T) {
	prog := mustParse(t, `component App(props: { n: number }) {
		while (props.n > 0) {
			<p>{props.n}</p>
		}
	}`)
	comp := compOf(t, prog, 0)
	wb, ok := comp.Body()[0].(*vsk.WhileBlock)
	if !ok {
		t.Fatalf("expected while block, got %T", comp.Body()[0])
	}
	if strings.TrimSpace(wb.Condition()) != "props.n > 0" {
		t.Fatalf("bad condition %q", wb.Condition())
	}
	if len(wb.Body()) != 1 {
		t.Fatalf("expected 1 body node, got %d", len(wb.Body()))
	}
}

func TestSwitch(t *testing.T) {
	prog := mustParse(t, `component App(props: { kind: string }) {
		switch (props.kind) {
			case "a":
				<p>A</p>
				break;
			case "b":
				<p>B</p>
				break;
			default:
				<p>Other</p>
		}
	}`)
	comp := compOf(t, prog, 0)
	sw, ok := comp.Body()[0].(*vsk.SwitchBlock)
	if !ok {
		t.Fatalf("expected switch block, got %T", comp.Body()[0])
	}
	if strings.TrimSpace(sw.Expression()) != "props.kind" {
		t.Fatalf("bad switch expr %q", sw.Expression())
	}
	if len(sw.Cases()) != 3 {
		t.Fatalf("expected 3 cases, got %d", len(sw.Cases()))
	}
	if !strings.HasPrefix(sw.Cases()[0].Test(), `"a"`) {
		t.Fatalf("bad case test %q", sw.Cases()[0].Test())
	}
	if len(sw.Cases()[0].Body()) != 2 {
		t.Fatalf("expected 2 case body nodes, got %d", len(sw.Cases()[0].Body()))
	}
	if !sw.Cases()[2].IsDefault() {
		t.Fatal("expected last case to be default")
	}
}

func TestTryCatch(t *testing.T) {
	prog := mustParse(t, `component App() {
		try {
			<div>try</div>
		} catch (e) {
			<p>caught</p>
		}
	}`)
	comp := compOf(t, prog, 0)
	tb, ok := comp.Body()[0].(*vsk.TryBlock)
	if !ok {
		t.Fatalf("expected try block, got %T", comp.Body()[0])
	}
	if len(tb.TryBody()) != 1 {
		t.Fatalf("expected 1 try body node, got %d", len(tb.TryBody()))
	}
	if tb.CatchParam() != "e" {
		t.Fatalf("expected catch param e, got %q", tb.CatchParam())
	}
	if len(tb.CatchBody()) != 1 {
		t.Fatalf("expected 1 catch body node, got %d", len(tb.CatchBody()))
	}
}

func TestVeskBlocks(t *testing.T) {
	prog := mustParse(t, `component App() {
		{#server}
			<div>Server only</div>
		{/server}
		{#client}
			<button onClick={() => {}}>Client</button>
		{/client}
	}`)
	comp := compOf(t, prog, 0)
	if len(comp.Body()) != 2 {
		t.Fatalf("expected 2 vesk blocks, got %d", len(comp.Body()))
	}
	first, ok := comp.Body()[0].(*vsk.VeskBlock)
	if !ok {
		t.Fatalf("expected vesk block, got %T", comp.Body()[0])
	}
	if first.Tag() != "server" {
		t.Fatalf("expected tag server, got %s", first.Tag())
	}
	second := comp.Body()[1].(*vsk.VeskBlock)
	if second.Tag() != "client" {
		t.Fatalf("expected tag client, got %s", second.Tag())
	}
	if len(second.Children()) != 1 {
		t.Fatalf("expected 1 client child, got %d", len(second.Children()))
	}
}

// ---------- mixed modes ----------

func TestMixedMode(t *testing.T) {
	prog := mustParse(t, `component A() {
		return <div>expr</div>;
	}
	component B() {
		<div>stmt</div>
	}`)
	if len(prog.Body()) != 2 {
		t.Fatalf("expected 2 components, got %d", len(prog.Body()))
	}
	a := compOf(t, prog, 0)
	if _, ok := a.Body()[0].(*vsk.ReturnStatement); !ok {
		t.Fatalf("expected return in A, got %T", a.Body()[0])
	}
	b := compOf(t, prog, 1)
	if _, ok := b.Body()[0].(*vsk.JSXElement); !ok {
		t.Fatalf("expected bare JSX in B, got %T", b.Body()[0])
	}
}

func TestWhitespaceTolerance(t *testing.T) {
	cases := []string{
		"component  App  (  )  {  return <div/>; }",
		"component App(){\n\treturn <div/>;\n}",
		"\ufeffcomponent App() { return <div/>; }",
		"component App() {\r\n\treturn <div/>;\r\n}",
	}
	for _, src := range cases {
		prog := mustParse(t, src)
		comp := compOf(t, prog, 0)
		if comp.Name() != "App" {
			t.Fatalf("%q: name=%s", src, comp.Name())
		}
	}
}

func TestNoTrailingNewline(t *testing.T) {
	prog := mustParse(t, `component App() {
		return <div>hi</div>;
	}`)
	if len(compOf(t, prog, 0).Body()) != 1 {
		t.Fatal("expected 1 body node")
	}
}

// ---------- accessors sanity ----------

func TestPositionSpans(t *testing.T) {
	src := `component App() {
	<div>Hello</div>
}`
	prog := mustParse(t, src)
	comp := compOf(t, prog, 0)
	if comp.Pos() != 0 || comp.End() != len(src) {
		t.Fatalf("bad component span %d..%d (len %d)", comp.Pos(), comp.End(), len(src))
	}
	jsx := comp.Body()[0]
	if src[jsx.Pos()] != '<' {
		t.Fatalf("jsx starts at %d, char %q", jsx.Pos(), src[jsx.Pos()])
	}
	if src[jsx.End()-1] != '>' {
		t.Fatalf("jsx ends at %d, char %q", jsx.End()-1, src[jsx.End()-1])
	}
}
