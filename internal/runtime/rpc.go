package runtime

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
)

// rpcConn is a newline-delimited JSON-RPC 2.0 connection over a CLI's
// stdin/stdout. It routes responses to pending calls and dispatches
// notifications and server-to-client requests concurrently.
type rpcConn struct {
	stdin io.WriteCloser

	writeMu sync.Mutex
	nextID  atomic.Int64

	pendingMu sync.Mutex
	pending   map[string]chan rpcResponse

	onNotification func(method string, params json.RawMessage)
	onRequest      func(method string, params json.RawMessage) (any, *rpcError)

	closed     chan struct{}
	closeOnce  sync.Once
	closeError error
}

type rpcResponse struct {
	result json.RawMessage
	err    error
}

type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method,omitempty"`
	Params  json.RawMessage `json:"params,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (e *rpcError) Error() string {
	if e == nil {
		return ""
	}
	return fmt.Sprintf("rpc error %d: %s", e.Code, e.Message)
}

func newRPCConn(stdin io.WriteCloser, stdout io.Reader, onNotification func(string, json.RawMessage), onRequest func(string, json.RawMessage) (any, *rpcError)) *rpcConn {
	conn := &rpcConn{
		stdin:          stdin,
		pending:        map[string]chan rpcResponse{},
		onNotification: onNotification,
		onRequest:      onRequest,
		closed:         make(chan struct{}),
	}
	go conn.readLoop(stdout)
	return conn
}

func (c *rpcConn) readLoop(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var message rpcMessage
		if err := json.Unmarshal(line, &message); err != nil {
			continue
		}
		switch {
		case message.Method != "" && len(message.ID) > 0:
			if c.onRequest != nil {
				go func(message rpcMessage) {
					result, rpcErr := c.onRequest(message.Method, message.Params)
					if rpcErr != nil {
						c.respondError(message.ID, rpcErr)
						return
					}
					c.respond(message.ID, result)
				}(message)
			} else {
				c.respondError(message.ID, &rpcError{Code: -32601, Message: "method not supported"})
			}
		case message.Method != "":
			if c.onNotification != nil {
				c.onNotification(message.Method, message.Params)
			}
		default:
			c.deliver(message)
		}
	}
	c.shutdown(errors.New("runtime closed the RPC stream"))
}

func (c *rpcConn) deliver(message rpcMessage) {
	key := string(message.ID)
	c.pendingMu.Lock()
	ch, ok := c.pending[key]
	if ok {
		delete(c.pending, key)
	}
	c.pendingMu.Unlock()
	if ok {
		response := rpcResponse{result: message.Result}
		if message.Error != nil {
			response.err = message.Error
		}
		ch <- response
	}
}

func (c *rpcConn) call(ctx context.Context, method string, params any) (json.RawMessage, error) {
	id := c.nextID.Add(1)
	key := fmt.Sprintf("%d", id)
	ch := make(chan rpcResponse, 1)
	c.pendingMu.Lock()
	c.pending[key] = ch
	c.pendingMu.Unlock()

	payload := map[string]any{"jsonrpc": "2.0", "id": id, "method": method}
	if params != nil {
		payload["params"] = params
	}
	if err := c.write(payload); err != nil {
		c.removePending(key)
		return nil, err
	}

	select {
	case response := <-ch:
		if response.err != nil {
			return nil, response.err
		}
		return response.result, nil
	case <-ctx.Done():
		c.removePending(key)
		return nil, ctx.Err()
	case <-c.closed:
		c.removePending(key)
		if c.closeError != nil {
			return nil, c.closeError
		}
		return nil, errors.New("runtime closed the RPC stream")
	}
}

func (c *rpcConn) notify(method string, params any) error {
	payload := map[string]any{"jsonrpc": "2.0", "method": method}
	if params != nil {
		payload["params"] = params
	}
	return c.write(payload)
}

func (c *rpcConn) respond(id json.RawMessage, result any) {
	payload := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id), "result": result}
	_ = c.write(payload)
}

func (c *rpcConn) respondError(id json.RawMessage, rpcErr *rpcError) {
	payload := map[string]any{"jsonrpc": "2.0", "id": json.RawMessage(id), "error": rpcErr}
	_ = c.write(payload)
}

func (c *rpcConn) write(payload any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	encoded = append(encoded, '\n')
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_, err = c.stdin.Write(encoded)
	return err
}

func (c *rpcConn) removePending(key string) {
	c.pendingMu.Lock()
	delete(c.pending, key)
	c.pendingMu.Unlock()
}

func (c *rpcConn) shutdown(err error) {
	c.closeOnce.Do(func() {
		c.closeError = err
		close(c.closed)
		c.pendingMu.Lock()
		for key, ch := range c.pending {
			delete(c.pending, key)
			select {
			case ch <- rpcResponse{err: err}:
			default:
			}
		}
		c.pendingMu.Unlock()
	})
}

func (c *rpcConn) close() {
	c.shutdown(errors.New("connection closed"))
	_ = c.stdin.Close()
}
