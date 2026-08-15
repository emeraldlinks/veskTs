package vsk_test

import (
	"strings"
	"testing"
	"time"

	"github.com/emeraldlinks/vesk/haul/internal/vsk"
)

func TestEdgeCasesNoHang(t *testing.T) {
	cases := []string{
		``,
		`   `,
		`component`,
		`component App`,
		`component App {`,
		`component App { }`,
		`component App() { return <div>`,
		`component App() { <div>`,
		`component App() { <div>unclosed`,
		`component App() { {#server}`,
		`component App() { {#server} <div/> `,
		`component App() { if (x) { } else`,
		`component App() { switch (x) { case "a": }`,
		`component App() { try { } `,
		`component App() { <>`,
		`component App() { <a><b><c>text`,
		`component App() { let &[a`,
		`component App() { let &[a] =`,
		`export`,
		`export default`,
		`import`,
		`import {`,
		`<div/>`,
		`export component App() { <div a={x} {...y} z /> }`,
		"component App() {\r\n\treturn <div/>;\r\n}",
		`component App() { {props.items.map((i) => <li>{i}</li>)} }`,
		`component App() { while (true) { } for (;;) { } }`,
	}
	for _, src := range cases {
		done := make(chan struct{})
		go func() {
			_, _ = vsk.Parse(src)
			close(done)
		}()
		select {
		case <-done:
		case <-time.After(2 * time.Second):
			t.Fatalf("parse hung on: %q", src)
		}
	}
}

func TestErrorMessages(t *testing.T) {
	cases := []struct {
		src     string
		keyword string
	}{
		{`component App() { <div>`, "unclosed"},
		{`component App() { let &[a] =`, "unexpected end"},
		{`component App() { {#server} `, "unexpected end"},
	}
	for _, c := range cases {
		_, err := vsk.Parse(c.src)
		if err == nil {
			t.Fatalf("%q: expected error", c.src)
		}
		if !strings.Contains(err.Error(), c.keyword) {
			t.Fatalf("%q: error %q missing %q", c.src, err, c.keyword)
		}
	}
}
