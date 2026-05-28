# Makefile for LinkVault (Vite Frontend & Go Serverless Backend)

# Load environment variables from .env file if it exists
ifneq (,$(wildcard .env))
    include .env
    export
endif

# Default target
.PHONY: help
help:
	@echo "Available commands:"
	@echo "  make install         - Install frontend and backend dependencies"
	@echo "  make dev-frontend    - Start Vite development server (port 5173)"
	@echo "  make dev-backend     - Run the Go backend API server locally (port 8080)"
	@echo "  make build-frontend  - Build the production frontend static bundle"
	@echo "  make build-backend   - Build/compile the Go backend locally"
	@echo "  make lint            - Run TypeScript lint check on the frontend"
	@echo "  make deploy-backend  - Deploy the Go backend container to Google Cloud Run"
	@echo "  make deploy-frontend - Deploy frontend static bundle to Firebase Hosting"
	@echo "  make deploy          - Deploy both Go backend and React frontend"
	@echo "  make clean           - Remove local build artifacts and binaries"

# Install dependencies
.PHONY: install
install:
	@echo "Installing frontend dependencies..."
	npm install
	@echo "Installing Go backend dependencies..."
	cd backend && go mod download

# Run local development servers
.PHONY: dev-frontend
dev-frontend:
	npm run dev

.PHONY: dev-backend
dev-backend:
	@if [ -z "$$GEMINI_API_KEY" ]; then \
		echo "Warning: GEMINI_API_KEY is not set. Go backend will fail to analyze URLs."; \
	fi
	cd backend && go run main.go

# Build binaries and static sites
.PHONY: build-frontend
build-frontend:
	npm run build

.PHONY: build-backend
build-backend:
	cd backend && go build -o linkvault-backend .

# Linting
.PHONY: lint
lint:
	npm run lint

# Clean
.PHONY: clean
clean:
	rm -rf dist
	rm -f backend/linkvault-backend

# Deploy targets
.PHONY: deploy-backend
deploy-backend:
	@if [ -z "$$VITE_FIREBASE_PROJECT_ID" ]; then \
		echo "Error: VITE_FIREBASE_PROJECT_ID (or FIREBASE_PROJECT_ID) environment variable is missing."; \
		exit 1; \
	fi
	@if [ -z "$$GEMINI_API_KEY" ]; then \
		echo "Error: GEMINI_API_KEY environment variable is missing."; \
		exit 1; \
	fi
	@echo "Ensuring Artifact Registry repository exists..."
	-gcloud artifacts repositories create linkvault \
		--repository-format=docker \
		--location=us-west1 \
		--project=$$VITE_FIREBASE_PROJECT_ID 2>/dev/null || true
	@echo "Submitting cached multi-stage build to Cloud Build..."
	cd backend && gcloud builds submit --config cloudbuild.yaml --project=$$VITE_FIREBASE_PROJECT_ID .
	@echo "Deploying built container image to Cloud Run..."
	gcloud run deploy linkvault-backend \
		--project=$$VITE_FIREBASE_PROJECT_ID \
		--image=us-west1-docker.pkg.dev/$$VITE_FIREBASE_PROJECT_ID/linkvault/backend:latest \
		--region us-west1 \
		--allow-unauthenticated \
		--set-env-vars="GEMINI_API_KEY=$$GEMINI_API_KEY,FIREBASE_PROJECT_ID=$$VITE_FIREBASE_PROJECT_ID"

.PHONY: deploy-frontend
deploy-frontend: build-frontend
	@echo "Deploying React frontend to Firebase Hosting..."
	npx firebase-tools deploy --only hosting --project=$$VITE_FIREBASE_PROJECT_ID

.PHONY: deploy
deploy: deploy-backend deploy-frontend
	@echo "LinkVault successfully deployed to production!"
