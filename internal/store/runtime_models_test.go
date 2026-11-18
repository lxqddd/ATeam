package store

import (
	"context"
	"testing"

	"github.com/lxqddd/ATeam/internal/domain"
)

func TestRuntimeModelConfigRoundTrip(t *testing.T) {
	ctx := context.Background()
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer func() { _ = st.Close() }()

	if _, err := st.GetRuntimeModelConfig(ctx, "claude"); err != ErrNotFound {
		t.Fatalf("missing config error = %v, want ErrNotFound", err)
	}

	config, err := st.SetRuntimeModelConfig(ctx, "claude", []domain.RuntimeModel{
		{ID: "sonnet", Label: "Claude Sonnet"},
		{ID: "opus"},
	})
	if err != nil {
		t.Fatalf("set config: %v", err)
	}
	if len(config.Models) != 2 || config.Models[0].ID != "sonnet" {
		t.Fatalf("config = %#v", config)
	}

	loaded, err := st.GetRuntimeModelConfig(ctx, "claude")
	if err != nil {
		t.Fatalf("get config: %v", err)
	}
	if len(loaded.Models) != 2 || loaded.Models[1].ID != "opus" {
		t.Fatalf("loaded = %#v", loaded)
	}

	replaced, err := st.SetRuntimeModelConfig(ctx, "claude", []domain.RuntimeModel{{ID: "haiku"}})
	if err != nil {
		t.Fatalf("replace config: %v", err)
	}
	if len(replaced.Models) != 1 || replaced.Models[0].ID != "haiku" {
		t.Fatalf("replaced = %#v", replaced)
	}
}
