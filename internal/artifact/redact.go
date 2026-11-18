package artifact

import (
	"regexp"

	"github.com/lxqddd/ATeam/internal/domain"
)

type redactionRule struct {
	pattern     *regexp.Regexp
	placeholder string
}

var redactionRules = []redactionRule{
	{
		pattern:     regexp.MustCompile(`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----`),
		placeholder: "[REDACTED:private_key]",
	},
	{
		pattern:     regexp.MustCompile(`\b(sk-[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b`),
		placeholder: "[REDACTED:api_key]",
	},
	{
		pattern:     regexp.MustCompile(`(?i)Bearer\s+[A-Za-z0-9._\-]{10,}`),
		placeholder: "Bearer [REDACTED:bearer_token]",
	},
	{
		// scheme://user:password@host — keep the user, drop the password.
		pattern:     regexp.MustCompile(`(\b[a-zA-Z][a-zA-Z0-9+.\-]*://[^:/\s@]+:)([^@\s]+)(@)`),
		placeholder: "${1}[REDACTED:db_password]${3}",
	},
}

// Redact replaces common secret patterns in text evidence and reports whether
// anything was replaced (M1-ART-006). Environment variables are never
// collected, so their values cannot leak through artifacts.
func Redact(data []byte) ([]byte, string) {
	result := data
	changed := false
	for _, rule := range redactionRules {
		if rule.pattern.Match(result) {
			result = rule.pattern.ReplaceAll(result, []byte(rule.placeholder))
			changed = true
		}
	}
	if changed {
		return result, domain.RedactionRedacted
	}
	return result, domain.RedactionNone
}
