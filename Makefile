SHELL := /bin/bash
.DEFAULT_GOAL := help

BIN_DIR := bin
APP := ateam
DB := .data/ateam.db
ADDR ?= 127.0.0.1:8787

.PHONY: help
help: ## Show available commands
	@echo "ATeam development commands:"
	@grep -E '^[a-zA-Z0-9_.-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

.PHONY: dev-server
dev-server: ## Run the Go API server
	go run ./cmd/ateam serve --addr $(ADDR) --db $(DB)

.PHONY: dev-web
dev-web: ## Run the Vue dev server (proxies /api to the Go server)
	pnpm --filter @ateam/web dev

.PHONY: dev-desktop
dev-desktop: ## Run the Wails desktop shell
	go run ./apps/desktop

.PHONY: web-install
web-install: ## Install workspace dependencies
	pnpm install

.PHONY: web-build
web-build: web-install ## Build the Vue app into apps/web/dist
	pnpm --filter @ateam/web build

.PHONY: build
build: web-build ## Build the server and desktop binaries
	mkdir -p $(BIN_DIR)
	go build -o $(BIN_DIR)/$(APP) ./cmd/ateam
	go build -o $(BIN_DIR)/ateam-desktop ./apps/desktop

.PHONY: test
test: ## Run Go tests and the Vue typecheck
	go test $(shell go list ./... | grep -v '/apps/desktop')
	pnpm --filter @ateam/web typecheck

.PHONY: fmt
fmt: ## Format Go code
	gofmt -w ./cmd ./internal ./apps/desktop

.PHONY: tidy
tidy: ## Tidy Go modules
	go mod tidy

.PHONY: clean
clean: ## Remove build and local data
	rm -rf $(BIN_DIR) .data apps/web/dist
