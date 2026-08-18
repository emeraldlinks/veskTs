package cli

import (
	"reflect"
	"testing"
)

func TestParsePortArgs(t *testing.T) {
	cases := []struct {
		name string
		args []string
		def  int
		want int
		rest []string
	}{
		{"no args", nil, 3000, 3000, nil},
		{"dash-p", []string{"-p", "3995"}, 3000, 3995, nil},
		{"double-dash-port", []string{"--port", "3994"}, 3000, 3994, nil},
		{"equals short", []string{"-p=3993"}, 3000, 3993, nil},
		{"equals long", []string{"--port=3992"}, 3000, 3992, nil},
		{"bare positional", []string{"3995"}, 3000, 3995, nil},
		{"bare positional wins over default", []string{"3995"}, 3001, 3995, nil},
		{"other flags preserved", []string{"-H", "0.0.0.0", "-p", "3995"}, 3000, 3995, []string{"-H", "0.0.0.0"}},
		{"other flags before port", []string{"--out", "dist", "3995"}, 3000, 3995, []string{"--out", "dist"}},
		{"last port wins", []string{"-p", "3995", "--port=3992"}, 3000, 3992, nil},
		{"bare after flags", []string{"--out", "dist", "3995"}, 3000, 3995, []string{"--out", "dist"}},
		{"non-numeric bare arg is rest", []string{"serve"}, 3000, 3000, []string{"serve"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, rest, err := parsePortArgs(c.args, c.def)
			if err != nil {
				t.Fatalf("parsePortArgs(%v) error: %v", c.args, err)
			}
			if got != c.want {
				t.Errorf("parsePortArgs(%v) = %d, want %d", c.args, got, c.want)
			}
			if !reflect.DeepEqual(rest, c.rest) {
				t.Errorf("parsePortArgs(%v) rest = %v, want %v", c.args, rest, c.rest)
			}
		})
	}
}

func TestParsePortArgsErrors(t *testing.T) {
	cases := []struct {
		name string
		args []string
	}{
		{"missing value", []string{"-p"}},
		{"non-numeric value", []string{"-p", "abc"}},
		{"port too large", []string{"999999"}},
		{"port zero", []string{"0"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if _, _, err := parsePortArgs(c.args, 3000); err == nil {
				t.Errorf("parsePortArgs(%v) expected error, got none", c.args)
			}
		})
	}
}
