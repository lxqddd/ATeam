package events

import (
	"bufio"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/lxqddd/ATeam/internal/security"
)

func TestServeSSEStreamsBroadcastEvents(t *testing.T) {
	hub := NewHub(security.NewGuard())
	server := httptest.NewServer(http.HandlerFunc(hub.ServeSSE))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("open sse: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("content-type = %q", got)
	}

	reader := bufio.NewReader(resp.Body)
	hub.Broadcast(Event{Type: "task.created", Data: map[string]string{"id": "t1"}})

	type result struct {
		event string
		data  string
	}
	lines := make(chan string, 8)
	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				close(lines)
				return
			}
			lines <- strings.TrimRight(line, "\r\n")
		}
	}()

	var event, data string
	deadline := time.After(3 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatalf("timeout waiting for sse event; got event=%q data=%q", event, data)
		case line, ok := <-lines:
			if !ok {
				t.Fatalf("stream closed; event=%q data=%q", event, data)
			}
			switch {
			case strings.HasPrefix(line, "event: "):
				event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			}
			if event != "" && strings.Contains(data, "t1") {
				if event != "message" {
					t.Fatalf("event name = %q", event)
				}
				return
			}
		}
	}
}

func TestServeWSRejectsForeignOrigin(t *testing.T) {
	guard := security.NewGuard()
	if err := guard.Bind("127.0.0.1:8787"); err != nil {
		t.Fatalf("bind guard: %v", err)
	}
	hub := NewHub(guard)
	server := httptest.NewServer(http.HandlerFunc(hub.ServeWS))
	defer server.Close()
	url := "ws" + strings.TrimPrefix(server.URL, "http")

	_, resp, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{"http://evil.example"}})
	if err == nil {
		t.Fatal("handshake succeeded for foreign origin")
	}
	if resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatalf("foreign origin status = %v, want 403", resp)
	}

	conn, _, err := websocket.DefaultDialer.Dial(url, http.Header{"Origin": []string{"http://127.0.0.1:8787"}})
	if err != nil {
		t.Fatalf("allowed origin dial: %v", err)
	}
	_ = conn.Close()
}
