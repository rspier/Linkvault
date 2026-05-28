# Use a lightweight Go alpine image to build the binary
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Download Go module dependencies.
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the application source code.
COPY . .

# Compile the Go application binary.
# CGO_ENABLED=0 produces a statically-linked binary.
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o main .

# Use a lightweight distroless image for execution
FROM gcr.io/distroless/static-debian12:latest

WORKDIR /

# Copy the binary from the builder stage
COPY --from=builder /app/main /main

# Expose port
EXPOSE 8080

# Run the Go binary
ENTRYPOINT ["/main"]
