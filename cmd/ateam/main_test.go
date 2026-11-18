package main

import "testing"

func TestResolveDataDir(t *testing.T) {
	if got := resolveDataDir("/tmp/demo/ateam.db", ""); got != "/tmp/demo" {
		t.Fatalf("derived data dir = %q", got)
	}
	if got := resolveDataDir("/tmp/demo/ateam.db", "/var/ateam"); got != "/var/ateam" {
		t.Fatalf("explicit data dir = %q", got)
	}
	if got := resolveDataDir("ateam.db", ""); got != "." {
		t.Fatalf("relative db data dir = %q", got)
	}
}
