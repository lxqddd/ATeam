package api

import (
	"path/filepath"
	"strings"
)

func validateAllowedPaths(paths []string) []map[string]string {
	fields := []map[string]string{}
	for _, entry := range paths {
		path := strings.TrimSpace(strings.ReplaceAll(entry, "\\", "/"))
		invalid := path == "" || filepath.IsAbs(path) || strings.Contains(path, "..") || strings.ContainsRune(path, ':')
		if invalid {
			fields = append(fields, map[string]string{"field": "allowedPaths", "value": entry, "reason": "must be a relative repository path without '..'"})
		}
	}
	return fields
}

func validateAllowedCommands(commands []string) []map[string]string {
	fields := []map[string]string{}
	for _, entry := range commands {
		command := strings.TrimSpace(entry)
		if command == "" || len(command) > 200 || strings.ContainsAny(command, ";|&><`") || strings.Contains(command, "$(") {
			fields = append(fields, map[string]string{"field": "allowedCommands", "value": entry, "reason": "must be an executable prefix without shell metacharacters"})
		}
	}
	return fields
}

func validPermissionMode(mode string) bool {
	switch mode {
	case "read_only", "controlled_edit", "full_access":
		return true
	default:
		return false
	}
}
