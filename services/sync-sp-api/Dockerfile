FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /worker ./cmd/worker
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sync-sales ./cmd/sync-sales
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sync-inventory ./cmd/sync-inventory
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sync-catalog ./cmd/sync-catalog
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /retry-reports ./cmd/retry-reports

FROM gcr.io/distroless/static-debian12
COPY --from=builder /worker /worker
COPY --from=builder /sync-sales /sync-sales
COPY --from=builder /sync-inventory /sync-inventory
COPY --from=builder /sync-catalog /sync-catalog
COPY --from=builder /retry-reports /retry-reports
ENTRYPOINT ["/worker"]
