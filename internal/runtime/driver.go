package runtime

import "context"

// SessionRequest is one harness session invocation: the manifest describing
// the CLI plus the run request ATeam already builds.
type SessionRequest struct {
	Manifest Manifest
	Request  Request
}

// Driver speaks one session transport with a CLI harness. Implementations
// own process launch, event parsing, cancellation and permission enforcement
// for that transport; callers stay transport-agnostic.
type Driver interface {
	Transport() Transport
	Run(ctx context.Context, req SessionRequest, emit func(Event)) error
}

// NewDriver returns the driver for a manifest's transport. Unsupported
// transports fail explicitly so callers never silently fall back.
func NewDriver(manifest Manifest) (Driver, bool) {
	switch manifest.Transport {
	case TransportStreamJSON:
		return &streamJSONDriver{manifest: manifest}, true
	case TransportACP:
		return &acpDriver{manifest: manifest}, true
	case TransportAppServer:
		return &appServerDriver{manifest: manifest}, true
	case TransportExec:
		return &execDriver{manifest: manifest}, true
	default:
		return nil, false
	}
}
