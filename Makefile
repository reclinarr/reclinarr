SHELL := /bin/bash
.DEFAULT_GOAL := help

TSC := node_modules/.bin/tsc
# Build order matters: client and providers import shared.
LIBS := shared client providers
COMPOSE := docker compose --env-file .env -f docker/docker-compose.yml

.PHONY: help setup install libs dev dev-mock dev-api dev-web mobile tv adb-reverse ios android tv-android \
	prebuild-mobile prebuild-tv build typecheck lint test check test-live e2e-web e2e-ios e2e-tv \
	docker-up docker-down docker-logs docker-build clean clean-all

help: ## Show this help
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n\033[1m%s\033[0m\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*## / {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

##@ Setup

setup: install libs ## First-time setup: dependencies, library build

install: ## Install dependencies
	npm install

libs: ## Build shared, client, providers (API and web import their dist/)
	@for p in $(LIBS); do echo "tsc packages/$$p"; $(TSC) -p packages/$$p/tsconfig.json || exit 1; done

##@ Development

# The trap stops the API and library watchers whenever the foreground web server exits
# (Ctrl-C, crash, quit), so none of them is left holding a port or watching files.
dev: libs ## API + web + library watchers; Ctrl-C stops all of them
	@trap 'kill $$pids 2>/dev/null; wait' EXIT; \
	for p in $(LIBS); do $(TSC) -p packages/$$p/tsconfig.json --watch --preserveWatchOutput & pids="$$pids $$!"; done; \
	npm run dev:api & pids="$$pids $$!"; \
	npm run dev:web

dev-mock: ## Same as dev, with mock backends (no Jellyfin / Seerr / Dispatcharr)
	RECLINARR_USE_MOCKS=true $(MAKE) dev

dev-api: libs ## API only (tsx watch)
	npm run dev:api

dev-web: libs ## Web only (Expo on :5173)
	npm run dev:web

##@ Native

mobile: libs ## Metro for the mobile app on :8081
	npm run start -w @reclinarr/mobile -- --port 8081

tv: libs ## Metro for the TV app on :8082 (run 'make adb-reverse' for the emulator)
	npm run start -w @reclinarr/tv -- --port 8082

adb-reverse: ## Point the TV emulator's localhost:8081 at TV Metro on :8082
	adb reverse tcp:8081 tcp:8082

ios: libs ## Build and launch the mobile dev build on the iOS Simulator
	npm run ios -w @reclinarr/mobile

android: libs ## Build and launch the mobile dev build on Android
	npm run android -w @reclinarr/mobile

tv-android: libs ## Build and launch the TV dev build on the Android TV emulator
	npm run android -w @reclinarr/tv

prebuild-mobile: ## Regenerate the mobile native projects (expo prebuild --clean)
	npm run prebuild -w @reclinarr/mobile

prebuild-tv: ## Regenerate the TV native projects (expo prebuild --clean)
	npm run prebuild -w @reclinarr/tv

##@ Checks

build: ## Production build of libraries, API and web
	npm run build

typecheck: ## Typecheck every workspace
	npm run typecheck

lint: ## Lint every workspace
	npm run lint

test: ## Unit tests
	npm test

check: typecheck lint test ## typecheck + lint + test

test-live: ## Live Dispatcharr ranking tests (needs real credentials in .env)
	npm run test:live -w @reclinarr/providers

##@ End-to-end (Maestro; keep 'make dev' running)

e2e-web: ## Web flows
	npm run test:e2e:web

e2e-ios: ## iOS flows: make e2e-ios UDID=<simulator udid>
	@test -n "$(UDID)" || { echo "UDID is required: make e2e-ios UDID=<simulator udid>"; exit 1; }
	npm run test:e2e:ios -- --udid $(UDID)

e2e-tv: ## TV flows: make e2e-tv UDID=<emulator udid>
	@test -n "$(UDID)" || { echo "UDID is required: make e2e-tv UDID=<emulator udid>"; exit 1; }
	npm run test:e2e:tv -- --udid $(UDID)

##@ Docker

docker-up: ## Build and start the container on :8787
	$(COMPOSE) up -d --build

docker-down: ## Stop the container
	$(COMPOSE) down

docker-logs: ## Follow container logs
	$(COMPOSE) logs -f

docker-build: ## Build the image without starting it
	$(COMPOSE) build

##@ Cleanup

clean: ## Remove build output
	rm -rf apps/*/dist packages/*/dist

clean-all: clean ## Also remove node_modules and Expo caches (run 'make setup' after)
	rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/*/.expo
