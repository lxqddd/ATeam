// Package security holds the guards for ATeam's local attack surface: it
// refuses non-loopback listeners and validates the Host and Origin headers so
// that a malicious web page cannot drive the local API or subscribe to its
// event stream (PRD security-and-permissions §3.2, MILE-002).
package security

import (
	"fmt"
	"net"
	"strings"
	"sync"
)

// Guard validates Host and Origin against an allowlist derived from the
// actual listen address. The zero value allows nothing; call Bind before
// serving requests.
type Guard struct {
	mu           sync.RWMutex
	origins      map[string]struct{}
	hosts        map[string]struct{}
	extraOrigins []string
}

func NewGuard() *Guard {
	return &Guard{
		origins: make(map[string]struct{}),
		hosts:   make(map[string]struct{}),
	}
}

// Bind derives the allowlist from the real listen address. Only loopback
// listeners are accepted; anything else is refused so the local API is never
// exposed to the network by accident. extra origins added with AllowOrigins
// before Bind are preserved.
func (g *Guard) Bind(listenAddr string) error {
	host, port, err := net.SplitHostPort(listenAddr)
	if err != nil {
		return fmt.Errorf("parse listen address %q: %w", listenAddr, err)
	}
	if !isLoopbackHost(host) {
		return fmt.Errorf("refusing to listen on %q: only loopback addresses (127.0.0.1, ::1, localhost) are allowed", listenAddr)
	}
	if port == "" || port == "0" {
		return fmt.Errorf("listen address %q has no concrete port", listenAddr)
	}

	origins := map[string]struct{}{
		"http://127.0.0.1:" + port: {},
		"http://localhost:" + port: {},
		"http://[::1]:" + port:     {},
	}
	hosts := map[string]struct{}{
		"127.0.0.1:" + port: {},
		"localhost:" + port: {},
		"[::1]:" + port:     {},
	}
	for _, origin := range g.extraOrigins {
		origins[origin] = struct{}{}
	}

	g.mu.Lock()
	g.origins = origins
	g.hosts = hosts
	g.mu.Unlock()
	return nil
}

func isLoopbackHost(host string) bool {
	if host == "" {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(strings.Trim(host, "[]")); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

// AllowOrigins adds explicit origins (for example the Vite dev server when
// ATEAM_DEV_ORIGINS is set). Entries are normalised to lower case.
func (g *Guard) AllowOrigins(origins ...string) {
	g.mu.Lock()
	defer g.mu.Unlock()
	for _, origin := range origins {
		origin = strings.ToLower(strings.TrimSpace(origin))
		if origin == "" {
			continue
		}
		g.extraOrigins = append(g.extraOrigins, origin)
		g.origins[origin] = struct{}{}
	}
}

// OriginAllowed reports whether a browser Origin may call the API. The empty
// origin means "no Origin header" (non-browser client) and is not handled
// here; "null" (sandboxed iframe, file:// pages) is always rejected.
func (g *Guard) OriginAllowed(origin string) bool {
	origin = strings.ToLower(strings.TrimSpace(origin))
	if origin == "" || origin == "null" {
		return false
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	_, ok := g.origins[origin]
	return ok
}

// HostAllowed reports whether the request Host matches the listen address
// (DNS rebinding mitigation).
func (g *Guard) HostAllowed(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	if host == "" {
		return false
	}
	g.mu.RLock()
	defer g.mu.RUnlock()
	_, ok := g.hosts[host]
	return ok
}
