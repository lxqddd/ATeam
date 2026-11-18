package domain

import "time"

// RunConfigSnapshot freezes the configuration a Run started with so history
// stays reproducible after the Agent changes (PRD api-and-data §9.3).
type RunConfigSnapshot struct {
	ID                 string    `json:"id"`
	RunID              string    `json:"runId"`
	AgentVersionID     string    `json:"agentVersionId,omitempty"`
	ConfigSnapshot     string    `json:"configSnapshot"`
	PromptHash         string    `json:"promptHash"`
	RuntimeVersion     string    `json:"runtimeVersion"`
	PermissionMode     string    `json:"permissionMode"`
	PermissionEnvelope string    `json:"permissionEnvelope"`
	CreatedAt          time.Time `json:"createdAt"`
}
