package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/emeraldlinks/vesk/haul/internal/sidecar"
)

type SidecarClient struct {
	Port int
	Cmd  *exec.Cmd
	// httpClient is shared across calls so the loopback TCP connection to
	// the sidecar is reused (keep-alive) instead of re-dialing per RPC —
	// per-call dials add measurable latency to every HMR rebuild.
	httpClient *http.Client
}

type JsonRpcRequest struct {
	Jsonrpc string `json:"jsonrpc"`
	ID      int    `json:"id"`
	Method  string `json:"method"`
	Params  []any  `json:"params,omitempty"`
}

type JsonRpcResponse struct {
	Jsonrpc string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *RpcError       `json:"error,omitempty"`
}

type RpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (c *SidecarClient) Close() error {
	if c.Cmd != nil && c.Cmd.Process != nil {
		_ = c.Cmd.Process.Kill()
	}
	return nil
}

func StartSidecar(ctx context.Context, projectDir string) (*SidecarClient, error) {
	sidecarPath := resolveSidecarPath(projectDir)
	if sidecarPath == "" {
		return nil, fmt.Errorf("vesk-compiler sidecar not found at %s", sidecarPath)
	}

	cmd := exec.CommandContext(ctx, "node", sidecarPath)
	sidecarDir := filepath.Dir(sidecarPath)
	if projectDir != "" {
		cmd.Dir = projectDir
	} else {
		cmd.Dir = sidecarDir
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("sidecar stdout: %w", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("sidecar start: %w", err)
	}

	decoder := json.NewDecoder(stdout)
	var portMsg map[string]int
	if err := decoder.Decode(&portMsg); err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("sidecar handshake: %w", err)
	}

	return &SidecarClient{
		Port:       portMsg["port"],
		Cmd:        cmd,
		httpClient: &http.Client{Timeout: 5 * time.Minute},
	}, nil
}

func (c *SidecarClient) Call(method string, params []any) (JsonRpcResponse, error) {
	req := JsonRpcRequest{
		Jsonrpc: "2.0",
		ID:      1,
		Method:  method,
		Params:  params,
	}
	body, err := json.Marshal(req)
	if err != nil {
		return JsonRpcResponse{}, err
	}

	url := fmt.Sprintf("http://127.0.0.1:%d", c.Port)
	httpReq, err := http.NewRequestWithContext(context.Background(), "POST", url, bytes.NewReader(body))
	if err != nil {
		return JsonRpcResponse{}, err
	}
	httpReq.Header.Set("Content-Type", "application/json")

	client := c.httpClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Minute}
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return JsonRpcResponse{}, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	var rpcResp JsonRpcResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return JsonRpcResponse{}, err
	}
	if rpcResp.Error != nil {
		return rpcResp, fmt.Errorf("rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	return rpcResp, nil
}

// CallResult is like Call but returns only the decoded result payload.
func (c *SidecarClient) CallResult(method string, params []any) (json.RawMessage, error) {
	resp, err := c.Call(method, params)
	if err != nil {
		return nil, err
	}
	return resp.Result, nil
}

func resolveSidecarPath(projectDir string) string {
	if p := os.Getenv("VESK_SIDECAR"); p != "" {
		if abs, err := filepath.Abs(p); err == nil && fileExists(abs) {
			return abs
		}
	}
	if exe, err := os.Executable(); err == nil {
		if abs, aerr := filepath.Abs(exe); aerr == nil {
			for _, c := range []string{
				filepath.Join(filepath.Dir(abs), "..", "sidecar.js"),
				filepath.Join(filepath.Dir(abs), "sidecar.js"),
			} {
				if fileExists(c) {
					return c
				}
			}
		}
	}
	// Last resort: the embedded bundle. Extract it into the project's .vesk/haul
	// dir so the user never needs a sidecar file — the binary ships the
	// compiler sidecar inside itself. `node` resolves @vesk/compiler,
	// @vesk/runtime and @vesk/adapter from the project's node_modules.
	if projectDir != "" && len(sidecar.SidecarJS) > 0 {
		dir := filepath.Join(projectDir, ".vesk", "haul")
		if err := os.MkdirAll(dir, 0o755); err == nil {
			p := filepath.Join(dir, "sidecar.js")
			if existing, err := os.ReadFile(p); err != nil || !bytes.Equal(existing, sidecar.SidecarJS) {
				if err := os.WriteFile(p, sidecar.SidecarJS, 0o644); err == nil {
					return p
				}
			} else {
				return p
			}
		}
	}
	return ""
}
