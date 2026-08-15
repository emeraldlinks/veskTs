package cache

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type Cache struct {
	dir   string
	index map[string]string
	mu    sync.RWMutex
}

var global *Cache

func Init(dir string) *Cache {
	if global != nil {
		return global
	}
	os.MkdirAll(dir, 0755)
	global = &Cache{
		dir:   dir,
		index: make(map[string]string),
	}
	return global
}

func GetGlobal() *Cache {
	return global
}

func (c *Cache) Dir() string {
	return c.dir
}

func ComputeKey(data []byte) string {
	return fmt.Sprintf("%x", sha256.Sum256(data))
}

func (c *Cache) Get(key string) ([]byte, bool) {
	c.mu.RLock()
	rel, ok := c.index[key]
	c.mu.RUnlock()
	if !ok {
		return nil, false
	}
	path := filepath.Join(c.dir, rel)
	b, err := os.ReadFile(path)
	if err != nil {
		c.mu.Lock()
		delete(c.index, key)
		c.mu.Unlock()
		return nil, false
	}
	return b, true
}

func (c *Cache) Set(key string, value []byte) {
	if c.dir == "" {
		return
	}
	rel := key[:2] + "/" + key + ".bin"
	path := filepath.Join(c.dir, rel)
	os.MkdirAll(filepath.Dir(path), 0755)
	os.WriteFile(path, value, 0644)
	c.mu.Lock()
	c.index[key] = rel
	c.mu.Unlock()
}

func (c *Cache) Has(key string) bool {
	c.mu.RLock()
	_, ok := c.index[key]
	c.mu.RUnlock()
	return ok
}

func (c *Cache) LoadIndex() error {
	if c.dir == "" {
		return nil
	}
	path := filepath.Join(c.dir, "index.json")
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, &c.index)
}

func (c *Cache) SaveIndex() error {
	if c.dir == "" {
		return nil
	}
	path := filepath.Join(c.dir, "index.json")
	b, _ := json.Marshal(c.index)
	return os.WriteFile(path, b, 0644)
}
