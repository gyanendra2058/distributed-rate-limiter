# Distributed Rate Limiter — API Gateway Architecture

A production-style distributed rate limiting system using the **API Gateway pattern**. Rate limiting is handled at the gateway layer, keeping the downstream API service focused on pure business logic.

## Architecture

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                     Docker Network                       │
                    │                                                          │
                    │  ┌─────────┐     ┌──────────────────┐     ┌───────────┐ │
                    │  │         │     │  API Gateway #1   │     │           │ │
                    │  │         │────▶│  :5000             │────▶│           │ │
  Clients ────▶ :8080  │  Nginx  │     │  (Rate Limiting)  │     │    API    │ │
                    │  │  (LB)   │     ├──────────────────┤     │   :3000   │ │
                    │  │         │────▶│  API Gateway #2   │────▶│  (Business│ │
                    │  │         │     │  :5000             │     │   Logic)  │ │
                    │  │         │     ├──────────────────┤     │           │ │
                    │  │         │────▶│  API Gateway #3   │────▶│           │ │
                    │  │         │     │  :5000             │     │           │ │
                    │  └─────────┘     └────────┬─────────┘     └───────────┘ │
                    │                           │                              │
                    │              ┌────────────┼────────────┐                │
                    │              ▼            ▼            ▼                │
                    │        ┌──────────┐ ┌──────────┐ ┌────────────┐        │
                    │        │  Redis   │ │  Config  │ │ Prometheus │        │
                    │        │  :6379   │ │  Service │ │   :9090    │        │
                    │        │ (State)  │ │  :4000   │ │(Monitoring)│        │
                    │        └──────────┘ └──────────┘ └────────────┘        │
                    └──────────────────────────────────────────────────────────┘
```

## Services

| Service | Port | Replicas | Responsibility |
|---------|------|----------|----------------|
| **Nginx** | 8080 | 1 | Load balances across gateway pods, routes `/config/` to config service |
| **API Gateway** | 5000 | 3 | Rate limiting (token bucket / sliding window), proxies allowed requests to API |
| **API** | 3000 | 1 | Business logic only — orders, products, checkout endpoints |
| **Config Service** | 4000 | 1 | Dynamic rate limit configuration, publishes updates via Redis pub/sub |
| **Redis** | 6379 | 1 | Stores rate limit state (atomic Lua scripts) and pub/sub for config updates |
| **Prometheus** | 9090 | 1 | Scrapes metrics from all 3 gateway pods |

## Rate Limiting Algorithms

Both algorithms execute atomically via Redis Lua scripts:

- **Token Bucket** (default) — Refillable tokens at a configurable rate. Allows short bursts up to bucket capacity.
- **Sliding Window Log** — Tracks individual request timestamps in a sorted set. Strict per-window counting with no burst allowance.

Select algorithm per request via the `X-Rate-Limit-Algo` header (`token-bucket` or `sliding-window`).

## API Endpoints

| Method | Path | Rate Limit | Description |
|--------|------|------------|-------------|
| GET | `/api/products` | 20 req, 5/sec refill, 60s window | List products |
| POST | `/api/order` | 5 req, 1/sec refill, 60s window | Create order |
| POST | `/api/checkout` | 3 req, 1/sec refill, 60s window | Process checkout |
| GET | `/metrics` | — | Prometheus metrics |

## How to Run

```bash
docker-compose up --build
```

### Test rate limiting

```bash
# Successful request
curl -H "X-User-Id: user1" http://localhost:8080/api/products

# Use sliding window algorithm
curl -H "X-User-Id: user1" -H "X-Rate-Limit-Algo: sliding-window" http://localhost:8080/api/products

# Check rate limit headers in response
# X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Algorithm
```

### Dynamic config update

```bash
# Update checkout rate limit
curl -X PUT http://localhost:8080/config/limits/checkout \
  -H "Content-Type: application/json" \
  -d '{"maxTokens": 10, "refillRate": 2, "windowSizeMs": 30000}'
```

### Load testing (k6)

```bash
# Token bucket test
k6 run k6/token-bucket-test.js

# Sliding window test
k6 run k6/sliding-window-test.js

# Algorithm comparison
k6 run k6/comparison-test.js
```

## Request Flow

```
Client
  → Nginx (round-robin to gateway pod)
    → Gateway Rate-Limit Middleware (check Redis, return 429 if exceeded)
      → Gateway Proxy Middleware (forward to API service)
        → API Controller (business logic, return response)
      ← Proxy adds X-RateLimit-* headers to response
    ← Response with rate limit headers
  ← Response to client
```
