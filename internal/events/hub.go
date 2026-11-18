package events

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/lxqddd/ATeam/internal/security"
)

type Event struct {
	Type string    `json:"type"`
	Data any       `json:"data,omitempty"`
	At   time.Time `json:"at"`
}

type Hub struct {
	mu         sync.Mutex
	clients    map[*client]struct{}
	sseClients map[chan []byte]struct{}
	upgrader   websocket.Upgrader
	guard      *security.Guard
}

func NewHub(guard *security.Guard) *Hub {
	hub := &Hub{
		clients:    make(map[*client]struct{}),
		sseClients: make(map[chan []byte]struct{}),
		guard:      guard,
	}
	hub.upgrader = websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     hub.checkOrigin,
	}
	return hub
}

// checkOrigin rejects WebSocket upgrades from browser origins outside the
// allowlist (MILE-002). Requests without an Origin header are non-browser
// clients; their Host is still validated by the API middleware.
func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return h.guard != nil && h.guard.OriginAllowed(origin)
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		slog.Warn("websocket upgrade failed", "error", err)
		return
	}

	connection := &client{hub: h, conn: conn, send: make(chan []byte, 64)}
	h.mu.Lock()
	h.clients[connection] = struct{}{}
	h.mu.Unlock()

	go connection.writePump()
	connection.readPump()
}

// ServeSSE streams events as Server-Sent Events. It is the browser-friendly
// alternative to the WebSocket endpoint and shares the same event payloads.
func (h *Hub) ServeSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	headers := w.Header()
	headers.Set("Content-Type", "text/event-stream")
	headers.Set("Cache-Control", "no-cache")
	headers.Set("Connection", "keep-alive")
	headers.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	stream := make(chan []byte, 64)
	done := make(chan struct{})

	h.mu.Lock()
	h.sseClients[stream] = struct{}{}
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.sseClients, stream)
		h.mu.Unlock()
		close(done)
	}()

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-done:
			return
		case <-heartbeat.C:
			if _, err := w.Write([]byte(": ping\n\n")); err != nil {
				return
			}
			flusher.Flush()
		case payload, ok := <-stream:
			if !ok {
				return
			}
			if _, err := w.Write([]byte("event: message\ndata: ")); err != nil {
				return
			}
			if _, err := w.Write(payload); err != nil {
				return
			}
			if _, err := w.Write([]byte("\n\n")); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (h *Hub) Broadcast(event Event) {
	if event.At.IsZero() {
		event.At = time.Now().UTC()
	}
	data, err := json.Marshal(event)
	if err != nil {
		slog.Warn("marshal websocket event", "error", err)
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()
	for connection := range h.clients {
		select {
		case connection.send <- data:
		default:
			close(connection.send)
			delete(h.clients, connection)
			_ = connection.conn.Close()
		}
	}
	for stream := range h.sseClients {
		select {
		case stream <- data:
		default:
			// Slow SSE consumer: drop this event rather than blocking the hub.
		}
	}
}

func (h *Hub) remove(connection *client) {
	h.mu.Lock()
	if _, ok := h.clients[connection]; ok {
		delete(h.clients, connection)
		close(connection.send)
	}
	h.mu.Unlock()
}

type client struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

func (c *client) readPump() {
	defer func() {
		c.hub.remove(c)
		_ = c.conn.Close()
	}()
	c.conn.SetReadLimit(4096)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

func (c *client) writePump() {
	ticker := time.NewTicker(30 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()
	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
