package ts

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"os"
	"strings"
)

func StripTS(source string) string {
	var buf bytes.Buffer
	scanner := bufio.NewScanner(strings.NewReader(source))
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			buf.WriteString(line)
			buf.WriteString("\n")
			continue
		}
		if strings.HasPrefix(trimmed, "//") {
			buf.WriteString(line)
			buf.WriteString("\n")
			continue
		}
		if strings.HasPrefix(trimmed, "/*") {
			buf.WriteString(line)
			buf.WriteString("\n")
			continue
		}
		if strings.HasPrefix(trimmed, "import ") && strings.Contains(trimmed, " from ") {
			if strings.Contains(trimmed, " type ") || strings.HasPrefix(trimmed, "import type ") {
				continue
			}
		}
		if strings.HasPrefix(trimmed, "export ") && strings.Contains(trimmed, " from ") {
			continue
		}
		if strings.HasPrefix(trimmed, "export ") || strings.HasPrefix(trimmed, "import ") {
			line = stripTypeArgs(line)
		}
		buf.WriteString(line)
		buf.WriteString("\n")
	}
	if err := scanner.Err(); err != nil && err != io.EOF {
		fmt.Fprintf(os.Stderr, "haul ts: scanner error: %v\n", err)
	}
	return buf.String()
}

func stripTypeArgs(s string) string {
	var buf bytes.Buffer
	buf.Grow(len(s))
	inAngle := 0
	inStr := rune(0)
	for _, r := range s {
		switch r {
		case '<':
			if inStr == 0 {
				inAngle++
				continue
			}
		case '>':
			if inStr == 0 {
				if inAngle > 0 {
					inAngle--
					continue
				}
			}
		case '\'', '"':
			if inStr == 0 {
				inStr = r
			} else if inStr == r {
				inStr = 0
			}
		}
		if inAngle == 0 {
			buf.WriteRune(r)
		}
	}
	return buf.String()
}
