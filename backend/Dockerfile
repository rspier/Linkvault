# Use a lightweight Go alpine image to build the binary
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Copy dependency files
COPY go.mod go.sum ./
# Cache Go modules
RUN --mount=type=cache,target=/go/pkg/mod go mod download

# Copy source code
COPY . .

# Build the binary using caching mounts for dependencies and compiler cache
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -o main .

# Use a lightweight distroless image for execution
FROM gcr.io/distroless/static-debian12:latest

WORKDIR /

# Copy the binary from the builder stage
COPY --from=builder /app/main /main

# Expose port
EXPOSE 8080

# Run the Go binary
ENTRYPOINT ["/main"]
