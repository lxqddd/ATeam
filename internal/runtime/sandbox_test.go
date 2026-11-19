package runtime

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeatbeltProfileIncludesBoundaries(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	workdir := filepath.Join(t.TempDir(), "work")
	manifest, _ := ManifestFor("opencode")
	profile := SeatbeltProfile(manifest, Request{Workdir: workdir, SandboxMode: SandboxModeSeatbelt})
	for _, want := range []string{
		"(deny default)",
		"(allow file-write*",
		workdir,
		`(literal "/")`,
		filepath.Join(home, ".local", "share", "opencode"),
	} {
		if !strings.Contains(profile, want) {
			t.Fatalf("profile missing %q:\n%s", want, profile)
		}
	}
	if strings.Contains(profile, filepath.Join(home, ".ssh")) {
		t.Fatalf("profile must not allow ~/.ssh:\n%s", profile)
	}
}

func TestWrapSandboxRejectsMissingMode(t *testing.T) {
	path, args := "/bin/echo", []string{"ok"}
	wrapped, wrappedArgs, err := wrapSandbox(Manifest{}, Request{Workdir: t.TempDir()}, path, args)
	if err != nil || wrapped != path || strings.Join(wrappedArgs, " ") != "ok" {
		t.Fatalf("none mode = %q %v %v", wrapped, wrappedArgs, err)
	}
	if SeatbeltAvailable() {
		return
	}
	if _, _, err := wrapSandbox(Manifest{}, Request{SandboxMode: SandboxModeSeatbelt}, path, args); err == nil {
		t.Fatal("seatbelt mode must fail when the sandbox is unavailable")
	}
}

func TestSeatbeltSandboxBlocksCredentialReads(t *testing.T) {
	if !SeatbeltAvailable() {
		t.Skip("sandbox-exec is not available")
	}
	// Put the fake home outside the temp roots the profile allows so a
	// credential read is actually denied.
	home, err := os.MkdirTemp("/Users/Shared", "ateam-sandbox-home-")
	if err != nil {
		t.Skipf("cannot create a fake home under /Users/Shared: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(home) })
	if err := os.MkdirAll(filepath.Join(home, ".ssh"), 0o700); err != nil {
		t.Fatal(err)
	}
	secretPath := filepath.Join(home, ".ssh", "id_test")
	if err := os.WriteFile(secretPath, []byte("TOP-SECRET"), 0o600); err != nil {
		t.Fatal(err)
	}
	workdir := t.TempDir()
	manifest, _ := ManifestFor("opencode")
	profile := SeatbeltProfile(manifest, Request{Workdir: workdir, SandboxMode: SandboxModeSeatbelt})

	readSecret := exec.Command("/usr/bin/sandbox-exec", "-p", profile, "--", "/bin/sh", "-c", `cat "$HOME/.ssh/id_test"`)
	readSecret.Env = append(os.Environ(), "HOME="+home)
	if output, err := readSecret.CombinedOutput(); err == nil {
		t.Fatalf("sandbox allowed reading ~/.ssh: %s", output)
	}

	target := filepath.Join(workdir, "allowed.txt")
	writeFile := exec.Command("/usr/bin/sandbox-exec", "-p", profile, "--", "/bin/sh", "-c", `printf ok > "$TARGET"`)
	writeFile.Env = append(os.Environ(), "HOME="+home, "TARGET="+target)
	if output, err := writeFile.CombinedOutput(); err != nil {
		t.Fatalf("sandbox blocked the worktree write: %v: %s", err, output)
	}
	data, err := os.ReadFile(target)
	if err != nil || string(data) != "ok" {
		t.Fatalf("worktree write = %q, %v", data, err)
	}

	outside := filepath.Join(home, "outside.txt")
	writeOutside := exec.Command("/usr/bin/sandbox-exec", "-p", profile, "--", "/bin/sh", "-c", `printf nope > "$TARGET"`)
	writeOutside.Env = append(os.Environ(), "HOME="+home, "TARGET="+outside)
	if output, err := writeOutside.CombinedOutput(); err == nil {
		t.Fatalf("sandbox allowed a home write: %s", output)
	}
}
