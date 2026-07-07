FROM golang:1.25-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /worker ./cmd/worker
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sync-profiles ./cmd/sync-profiles
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sync-campaigns ./cmd/sync-campaigns
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /sync-metrics ./cmd/sync-metrics
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /retry-reports ./cmd/retry-reports

FROM gcr.io/distroless/static-debian12
COPY --from=builder /worker /worker
COPY --from=builder /sync-profiles /sync-profiles
COPY --from=builder /sync-campaigns /sync-campaigns
COPY --from=builder /sync-metrics /sync-metrics
COPY --from=builder /retry-reports /retry-reports
ENTRYPOINT ["/worker"]
