package gateway

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Provider is one upstream OpenAI-compatible endpoint.
type Provider struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"` // openai
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"-"`
	Model   string `json:"model"`
	Default bool   `json:"default"`
}

// ProviderView is the API-safe provider shape. APIKey is masked.
type ProviderView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
	Default bool   `json:"default"`
}

type persistedProvider struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Kind      string `json:"kind"`
	BaseURL   string `json:"baseUrl"`
	APIKeyEnc string `json:"apiKeyEnc"`
	Model     string `json:"model"`
	Default   bool   `json:"default"`
}

type persistedConfig struct {
	Token     string              `json:"token"`
	Providers []persistedProvider `json:"providers"`
}

// Manager owns the gateway token and encrypted provider configuration.
type Manager struct {
	mu      sync.Mutex
	dir     string
	key     []byte
	config  persistedConfig
	baseURL string
}

// New loads (or creates) the gateway configuration and encryption key.
func New(dir string) (*Manager, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create gateway directory: %w", err)
	}
	manager := &Manager{dir: dir}
	key, err := loadOrCreateKey(filepath.Join(dir, "gateway.key"))
	if err != nil {
		return nil, err
	}
	manager.key = key
	if err := manager.load(); err != nil {
		return nil, err
	}
	if manager.config.Token == "" {
		token, err := randomToken()
		if err != nil {
			return nil, err
		}
		manager.config.Token = token
		if err := manager.saveLocked(); err != nil {
			return nil, err
		}
	}
	return manager, nil
}

func (m *Manager) load() error {
	data, err := os.ReadFile(filepath.Join(m.dir, "gateway.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read gateway config: %w", err)
	}
	if err := json.Unmarshal(data, &m.config); err != nil {
		return fmt.Errorf("decode gateway config: %w", err)
	}
	return nil
}

func (m *Manager) saveLocked() error {
	data, err := json.MarshalIndent(m.config, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(m.dir, "gateway.json")
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0o600); err != nil {
		return fmt.Errorf("write gateway config: %w", err)
	}
	return os.Rename(temp, path)
}

// Token returns the bearer token clients use as their API key.
func (m *Manager) Token() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.config.Token
}

// SetBaseURL records the loopback gateway URL used when ATeam injects the
// gateway into a CLI's environment.
func (m *Manager) SetBaseURL(baseURL string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.baseURL = strings.TrimRight(baseURL, "/")
}

// BaseURL returns the loopback gateway URL.
func (m *Manager) BaseURL() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.baseURL
}

// Configured reports whether at least one provider exists.
func (m *Manager) Configured() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.config.Providers) > 0
}

// RotateToken invalidates the previous gateway token.
func (m *Manager) RotateToken() (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	token, err := randomToken()
	if err != nil {
		return "", err
	}
	m.config.Token = token
	if err := m.saveLocked(); err != nil {
		return "", err
	}
	return token, nil
}

// Providers returns decrypted providers for internal routing.
func (m *Manager) Providers() []Provider {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.providersLocked()
}

func (m *Manager) providersLocked() []Provider {
	result := make([]Provider, 0, len(m.config.Providers))
	for _, item := range m.config.Providers {
		apiKey := decryptKey(m.key, item.APIKeyEnc)
		result = append(result, Provider{
			ID: item.ID, Name: item.Name, Kind: item.Kind, BaseURL: item.BaseURL,
			APIKey: apiKey, Model: item.Model, Default: item.Default,
		})
	}
	return result
}

// ProviderViews returns masked providers for the API.
func (m *Manager) ProviderViews() []ProviderView {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]ProviderView, 0, len(m.config.Providers))
	for _, item := range m.config.Providers {
		result = append(result, providerViewLocked(item))
	}
	return result
}

// ProviderInput is the create/update payload. An empty APIKey on update keeps
// the stored key.
type ProviderInput struct {
	ID      string `json:"-"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
	Model   string `json:"model"`
	Default bool   `json:"default"`
}

func (m *Manager) Upsert(input ProviderInput) (ProviderView, error) {
	input.Name = strings.TrimSpace(input.Name)
	input.Kind = strings.TrimSpace(input.Kind)
	input.BaseURL = strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	input.APIKey = strings.TrimSpace(input.APIKey)
	input.Model = strings.TrimSpace(input.Model)
	if input.Name == "" || input.BaseURL == "" {
		return ProviderView{}, errors.New("name and baseUrl are required")
	}
	if !strings.HasPrefix(input.BaseURL, "https://") && !strings.HasPrefix(input.BaseURL, "http://") {
		return ProviderView{}, errors.New("baseUrl must start with http:// or https://")
	}
	if input.Kind == "" {
		input.Kind = "openai"
	}
	if input.Kind != "openai" {
		return ProviderView{}, errors.New("only the openai provider kind is supported")
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	id := strings.TrimSpace(input.ID)
	if id == "" {
		id = randomID()
	}
	index := -1
	for i, item := range m.config.Providers {
		if item.ID == id {
			index = i
			break
		}
	}
	if input.Default {
		for i := range m.config.Providers {
			m.config.Providers[i].Default = false
		}
	}
	if index >= 0 {
		existing := m.config.Providers[index]
		enc := existing.APIKeyEnc
		if input.APIKey != "" {
			encrypted, err := encryptKey(m.key, input.APIKey)
			if err != nil {
				return ProviderView{}, err
			}
			enc = encrypted
		}
		m.config.Providers[index] = persistedProvider{
			ID: id, Name: input.Name, Kind: input.Kind, BaseURL: input.BaseURL,
			APIKeyEnc: enc, Model: input.Model, Default: input.Default,
		}
	} else {
		encrypted := ""
		if input.APIKey != "" {
			var err error
			encrypted, err = encryptKey(m.key, input.APIKey)
			if err != nil {
				return ProviderView{}, err
			}
		}
		m.config.Providers = append(m.config.Providers, persistedProvider{
			ID: id, Name: input.Name, Kind: input.Kind, BaseURL: input.BaseURL,
			APIKeyEnc: encrypted, Model: input.Model, Default: input.Default,
		})
	}
	if err := m.saveLocked(); err != nil {
		return ProviderView{}, err
	}
	for _, item := range m.config.Providers {
		if item.ID == id {
			return providerViewLocked(item), nil
		}
	}
	return ProviderView{}, errors.New("provider not found after save")
}

func providerViewLocked(item persistedProvider) ProviderView {
	masked := ""
	if item.APIKeyEnc != "" {
		masked = "••••••••"
	}
	return ProviderView{
		ID: item.ID, Name: item.Name, Kind: item.Kind, BaseURL: item.BaseURL,
		APIKey: masked, Model: item.Model, Default: item.Default,
	}
}

func (m *Manager) Delete(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	kept := m.config.Providers[:0]
	for _, item := range m.config.Providers {
		if item.ID != id {
			kept = append(kept, item)
		}
	}
	m.config.Providers = kept
	return m.saveLocked()
}

// Route selects the provider for a requested model. A "providerId/model"
// prefix wins; otherwise the default provider, then the first provider.
func (m *Manager) Route(model string) (Provider, string, bool) {
	providers := m.Providers()
	if len(providers) == 0 {
		return Provider{}, model, false
	}
	if slash := strings.IndexByte(model, '/'); slash > 0 {
		prefix := model[:slash]
		for _, provider := range providers {
			if provider.ID == prefix {
				target := strings.TrimPrefix(model, prefix+"/")
				if provider.Model != "" {
					target = provider.Model
				}
				return provider, target, true
			}
		}
	}
	for _, provider := range providers {
		if provider.Default {
			target := provider.Model
			if target == "" {
				target = model
			}
			return provider, target, true
		}
	}
	provider := providers[0]
	target := provider.Model
	if target == "" {
		target = model
	}
	return provider, target, true
}

func loadOrCreateKey(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err == nil && len(data) == 32 {
		return data, nil
	}
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read gateway key: %w", err)
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	if err := os.WriteFile(path, key, 0o600); err != nil {
		return nil, fmt.Errorf("write gateway key: %w", err)
	}
	return key, nil
}

func encryptKey(key []byte, value string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(value), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

func decryptKey(key []byte, encoded string) string {
	if encoded == "" {
		return ""
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return ""
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return ""
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return ""
	}
	if len(data) < gcm.NonceSize() {
		return ""
	}
	plain, err := gcm.Open(nil, data[:gcm.NonceSize()], data[gcm.NonceSize():], nil)
	if err != nil {
		return ""
	}
	return string(plain)
}

func randomToken() (string, error) {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "ateam-gw-" + hex.EncodeToString(buf), nil
}

func randomID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("provider-%d", os.Getpid())
	}
	return "provider-" + hex.EncodeToString(buf)
}
