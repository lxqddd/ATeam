package events

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Event struct {
	Type string    `json:"type"`
	Data any       `json:"data,omitempty"`
	At   time.Time `json:"at"`
}

type Hub struct {
	mu       sync.Mutex
	clients  map[*client]struct{}
	upgrader websocket.Upgrader
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*client]struct{}),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  1024,
			WriteBufferSize: 1024,
			CheckOrigin:     func(r *http.Request) bool { return true },
		},
	}
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
