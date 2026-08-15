package audit

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

type Finding struct {
	File   string `json:"file"`
	Line   int    `json:"line"`
	Column int    `json:"column"`
	Rule   string `json:"rule"`
	Detail string `json:"detail"`
}

type Report struct {
	Findings []Finding `json:"findings"`
	Passed   int       `json:"passed"`
	Failed   int       `json:"failed"`
}

func ScanDir(dir string) *Report {
	r := &Report{Findings: []Finding{}}
	if dir == "" {
		return r
	}
	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if ext != ".js" && ext != ".css" && ext != ".html" && ext != ".ts" {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		scanBytes(r, path, b)
		return nil
	})
	r.Passed = len(r.Findings)
	r.Failed = len(r.Findings)
	return r
}

func scanBytes(r *Report, path string, b []byte) {
	lines := strings.Split(string(b), "\n")
	for i, line := range lines {
		if strings.Contains(line, "eval(") {
			r.Findings = append(r.Findings, Finding{
				File:   path,
				Line:   i + 1,
				Rule:   "no-eval",
				Detail: "eval() usage detected",
			})
		}
		if strings.Contains(line, "new Function(") {
			r.Findings = append(r.Findings, Finding{
				File:   path,
				Line:   i + 1,
				Rule:   "no-new-function",
				Detail: "new Function() usage detected",
			})
		}
		if strings.Contains(line, "setTimeout(") && strings.Contains(line, "string") {
			r.Findings = append(r.Findings, Finding{
				File:   path,
				Line:   i + 1,
				Rule:   "no-string-timeout",
				Detail: "setTimeout with string argument detected",
			})
		}
		if strings.Contains(line, "innerHTML") && strings.Contains(line, "=") {
			r.Findings = append(r.Findings, Finding{
				File:   path,
				Line:   i + 1,
				Rule:   "no-innerhtml",
				Detail: "innerHTML assignment detected",
			})
		}
		if strings.Contains(line, "document.write(") {
			r.Findings = append(r.Findings, Finding{
				File:   path,
				Line:   i + 1,
				Rule:   "no-document-write",
				Detail: "document.write usage detected",
			})
		}
	}
}

func HashFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256(b)
	return "sha256-" + base64.StdEncoding.EncodeToString(h[:]), nil
}

func WriteManifest(dir string, files []string) error {
	type entry struct {
		Path string `json:"path"`
		Sri  string `json:"sri"`
	}
	manifest := []entry{}
	for _, f := range files {
		sri, err := HashFile(f)
		if err != nil {
			continue
		}
		rel, _ := filepath.Rel(dir, f)
		manifest = append(manifest, entry{Path: rel, Sri: sri})
	}
	b, _ := json.MarshalIndent(manifest, "", "  ")
	return os.WriteFile(filepath.Join(dir, "sri-manifest.json"), b, 0644)
}
