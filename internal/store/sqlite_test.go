package store

import (
	"context"
	"testing"

	"github.com/lxqddd/ATeam/internal/domain"
)

func TestTaskLifecycle(t *testing.T) {
	ctx := context.Background()
	st, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer st.Close()

	task := &domain.Task{
		Title:       "Smoke test",
		Description: "hello",
		Status:      domain.TaskTodo,
	}
	if err := st.CreateTask(ctx, task); err != nil {
		t.Fatalf("create task: %v", err)
	}
	if task.ID == "" {
		t.Fatal("expected generated id")
	}

	got, err := st.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatalf("get task: %v", err)
	}
	if got.Title != "Smoke test" {
		t.Fatalf("title = %q", got.Title)
	}

	got.Status = domain.TaskInProgress
	if err := st.UpdateTask(ctx, got); err != nil {
		t.Fatalf("update task: %v", err)
	}

	list, err := st.ListTasks(ctx)
	if err != nil {
		t.Fatalf("list tasks: %v", err)
	}
	if len(list) != 1 || list[0].Status != domain.TaskInProgress {
		t.Fatalf("unexpected list: %#v", list)
	}

	if err := st.DeleteTask(ctx, task.ID); err != nil {
		t.Fatalf("delete task: %v", err)
	}
	if _, err := st.GetTask(ctx, task.ID); err == nil {
		t.Fatal("expected not found after delete")
	}
}
