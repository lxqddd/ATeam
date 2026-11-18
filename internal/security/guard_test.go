package security

import "testing"

func TestGuardBindDerivesLoopbackAllowlist(t *testing.T) {
	g := NewGuard()
	if err := g.Bind("127.0.0.1:8787"); err != nil {
		t.Fatalf("bind: %v", err)
	}

	allowedOrigins := []string{
		"http://127.0.0.1:8787",
		"http://localhost:8787",
		"http://[::1]:8787",
		"HTTP://127.0.0.1:8787",
	}
	for _, origin := range allowedOrigins {
		if !g.OriginAllowed(origin) {
			t.Errorf("origin %q should be allowed", origin)
		}
	}

	rejectedOrigins := []string{
		"",
		"null",
		"http://evil.example",
		"https://127.0.0.1:8787",
		"http://127.0.0.1:9999",
	}
	for _, origin := range rejectedOrigins {
		if g.OriginAllowed(origin) {
			t.Errorf("origin %q should be rejected", origin)
		}
	}

	allowedHosts := []string{"127.0.0.1:8787", "localhost:8787", "[::1]:8787"}
	for _, host := range allowedHosts {
		if !g.HostAllowed(host) {
			t.Errorf("host %q should be allowed", host)
		}
	}

	rejectedHosts := []string{"", "evil.example", "evil.example:8787", "127.0.0.1:9999"}
	for _, host := range rejectedHosts {
		if g.HostAllowed(host) {
			t.Errorf("host %q should be rejected", host)
		}
	}
}

func TestGuardRefusesNonLoopbackAndUnboundPort(t *testing.T) {
	for _, addr := range []string{"0.0.0.0:8787", "192.168.1.20:8787", "127.0.0.1:0", "127.0.0.1"} {
		g := NewGuard()
		if err := g.Bind(addr); err == nil {
			t.Errorf("bind %q should fail", addr)
		}
	}
}

func TestGuardKeepsExplicitDevOrigins(t *testing.T) {
	g := NewGuard()
	g.AllowOrigins("http://127.0.0.1:5173", " http://localhost:5173 ")
	if err := g.Bind("127.0.0.1:8787"); err != nil {
		t.Fatalf("bind: %v", err)
	}
	for _, origin := range []string{"http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8787"} {
		if !g.OriginAllowed(origin) {
			t.Errorf("origin %q should be allowed", origin)
		}
	}
	if g.OriginAllowed("http://evil.example") {
		t.Error("unknown origin should stay rejected")
	}
}

func TestUnboundGuardAllowsNothing(t *testing.T) {
	g := NewGuard()
	if g.OriginAllowed("http://127.0.0.1:8787") || g.HostAllowed("127.0.0.1:8787") {
		t.Fatal("unbound guard must reject everything")
	}
}
