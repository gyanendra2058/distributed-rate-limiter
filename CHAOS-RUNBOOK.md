# Chaos Testing Runbook — Distributed Rate Limiter

## Approach
Each phase follows **Break → Fix → Verify**. Deploy intentionally fragile, observe breakage on Grafana, apply targeted fix, re-run same test.

---

## Phase 0: Minimal Wiring + Observability ✅ DONE

- [x] Create `redis.factory.ts` — configurable Redis/Cluster client factory
- [x] Wire factory into `rate-limiter.service.ts`, `config-subscriber.service.ts`, `config.service.ts`
- [x] Add `rate_limit_check_duration_seconds` histogram to `metrics.service.ts`
- [x] Add `startTimer()` instrumentation in `gateway.middleware.ts`
- [x] Create `/health` endpoint (controller + module)
- [x] Import `HealthModule` in `app.module.ts`
- [x] Add `/health` route in `nginx.conf`
- [x] Add Grafana service to `docker-compose.yml`
- [x] Create Grafana provisioning (datasource + dashboard config)
- [x] Create RED dashboard JSON (Rate, Errors, Duration panels)
- [x] Create `k6/ramp-stress-test.js` (100 → 500 → 1000 RPS, 50 users)
- [x] Create `k6/memory-pressure-test.js` (10K unique users)
- [x] Create `deploy/run-k6.sh` runner script
- [x] Verify locally: `docker compose up`, test endpoints, check Grafana

**Status:** All services running. Grafana dashboard at `localhost:3000/d/rate-limiter-red/`

---

## Phase 1: Deploy to AWS (ElastiCache + EC2)

**Cost:** $0 (free tier — cache.t3.micro + t2.micro EC2)

### Tasks
- [x] Create `deploy/setup-elasticache.sh`
  - Read `.env.ec2` for VPC/SG/region
  - Create cache subnet group from default VPC subnets
  - Create SG rule: allow port 6379 from EC2 SG
  - Create single-node cluster: `cache.t3.micro`, Redis 7.1
  - Wait for available, extract endpoint, save to `deploy/.env.elasticache`
- [x] Create `docker-compose.elasticache.yml`
  - Disable containerized `redis` via `profiles: ["disabled"]`
  - Override `REDIS_HOST` to ElastiCache endpoint
- [x] Update `deploy/deploy-ec2.sh`
  - If `.env.elasticache` exists, add ElastiCache compose override
  - Open ports 3000 (Grafana), 3001 (Dashboard), 9090 (Prometheus) in SG
- [ ] Run `deploy/setup-ec2.sh` (if EC2 not already provisioned)
- [ ] Run `deploy/setup-elasticache.sh`
- [ ] Run `deploy/deploy-ec2.sh`
- [ ] Verify: `curl http://<EC2_IP>:8080/api/products`
- [ ] Verify: `curl http://<EC2_IP>:8080/health`
- [ ] Verify: Grafana at `http://<EC2_IP>:3000/d/rate-limiter-red/`

---

## Phase 2: CT-2 Latency Spike (Break → Observe)

**Cost:** $0 (same single-node ElastiCache)

### BREAK
- [ ] Run from local machine: `deploy/run-k6.sh ramp-stress-test.js`
- [ ] Watch Grafana Duration panels live as RPS ramps 100 → 500 → 1000

### What to observe
- [ ] At what RPS does p99 cross 50ms?
- [ ] At what RPS does p99 cross 100ms?
- [ ] Does the gateway degrade gracefully or fall off a cliff?
- [ ] Check CloudWatch: ElastiCache CPU utilization

### Outcome
No fix — this finds the **saturation point** of `cache.t3.micro`. Record the numbers for comparison later.

---

## Phase 3: CT-3 Memory Exhaustion (Break → Fix → Verify)

**Cost:** $0 (same single-node ElastiCache)

### BREAK
- [ ] Run: `deploy/run-k6.sh memory-pressure-test.js`
- [ ] Watch Grafana rejection ratio — it should DROP (users bypassing rate limits)
- [ ] Check CloudWatch: `BytesUsedForCache` hitting 100%, `Evictions` spiking

### What breaks
Rate limit keys get evicted → users get fresh token buckets → rate limits bypassed.

### FIX
- [ ] Modify `deploy/setup-elasticache.sh`: create a custom parameter group with `maxmemory-policy = volatile-ttl`
- [ ] Apply parameter group to the ElastiCache cluster
- [ ] Reboot cache node to apply changes

### VERIFY
- [ ] Re-run: `deploy/run-k6.sh memory-pressure-test.js`
- [ ] Evictions still happen, but active rate limit keys survive longer
- [ ] Rejection ratio stays more accurate under memory pressure

---

## Phase 4: CT-4 Connection Backpressure (Break → Fix → Verify)

**Cost:** $0 (same single-node ElastiCache)

### BREAK
- [ ] Run ramp test at 1000 RPS while Redis is saturated
- [ ] Monitor gateway container memory: `docker stats` or CloudWatch
- [ ] ioredis offline queue grows unbounded → gateway memory climbs

### What breaks
Gateway pod memory grows linearly. Possible OOM-kill and pod restart. Grafana goes dark for that pod.

### FIX
- [ ] Modify `api-gateway/src/redis/redis.factory.ts`:
  - Add `maxRetriesPerRequest: 3`
  - Add `enableOfflineQueue: false`
  - Add `connectTimeout: 5000`
  - Add `commandTimeout: 2000`
- [ ] Rebuild and redeploy api-gateway

### VERIFY
- [ ] Re-run 1000 RPS test
- [ ] Gateway memory stays flat
- [ ] Excess commands get fast errors instead of queuing
- [ ] Grafana shows some 500s (expected) but pod stays alive

---

## Phase 5: CT-1 Node Death / Failover (Break → Fix → Verify)

**Cost:** ~$12/month over free tier (2x cache.t3.micro)

### Setup
- [ ] Create `deploy/setup-elasticache-replication.sh`
  - Delete single-node cluster
  - Create replication group: primary + replica, Multi-AZ, auto-failover
  - Extract primary endpoint, update `.env.elasticache`
- [ ] Create `deploy/chaos-failover-test.sh`
  - Pre-flight: verify replication group available, app healthy
  - Start k6 at 200 RPS for 120s in background
  - Wait 30s, trigger failover
  - Poll until available, measure duration
  - Print report: failover duration, 500 count, time-to-recovery
- [ ] Run `deploy/setup-elasticache-replication.sh`
- [ ] Redeploy app with new endpoint

### BREAK
- [ ] Run `deploy/chaos-failover-test.sh`
- [ ] Watch Grafana: `rate_limit_hits_total` drops to ZERO
- [ ] k6 output: HTTP 500 spike for ~15-30 seconds
- [ ] Gateway logs: unhandled promise rejection spam

### What breaks
All 3 gateway pods return 500 for entire failover window (~15-30s). No error handling = total outage.

### FIX
- [ ] Modify `api-gateway/src/rate-limiter/rate-limiter.service.ts`:
  - Wrap both `redis.eval()` calls in try-catch
  - Add `redisHealthy` boolean + 5-second `setInterval` ping probe
  - Add in-memory local fallback (`Map<string, {tokens, lastRefill}>`)
  - Add `RATE_LIMIT_FAIL_OPEN` env var (default `true`)
- [ ] Modify `api-gateway/src/metrics/metrics.service.ts`:
  - Add `Gauge` `rate_limit_fallback_active` (0 or 1)
  - Add `Counter` `rate_limit_fallback_total` (label: `endpoint`)
- [ ] Update Grafana dashboard: add fallback panels to Errors row
- [ ] Rebuild and redeploy

### VERIFY
- [ ] Re-run `deploy/chaos-failover-test.sh`
- [ ] **Before:** 500s for 15-30s, hits drop to zero
- [ ] **After:** 0 errors, `fallback_active` = 1 during failover, requests continue via local fallback
- [ ] Grafana: fallback spike → recovery → distributed rate limiting resumes

---

## Phase 6: CT-6 Pub/Sub Disconnect (Break → Fix → Verify)

**Cost:** Same replication group from Phase 5

### BREAK
- [ ] Update config via dashboard: `PUT /config/limits/products` — verify propagation works
- [ ] Trigger failover: `aws elasticache test-failover ...`
- [ ] Wait for recovery
- [ ] Update config again via dashboard
- [ ] Check if gateways received the update → **they didn't**

### What breaks
Pub/sub subscriber doesn't re-subscribe after reconnect. Config updates silently stop. Gateways serve stale config indefinitely. No errors, no logs — the most insidious failure.

### FIX
- [ ] Modify `api-gateway/src/config/config-subscriber.service.ts`:
  - Add `on('error')` handler on subscriber connection
  - Wrap `subscribe()` in try-catch
  - Add reconnect handler that re-subscribes + reloads all limits
  - Wrap `hgetall()` in try-catch

### VERIFY
- [ ] Update config → verify propagation
- [ ] Trigger failover → wait for recovery
- [ ] Update config again → **now it propagates**
- [ ] Gateway logs: disconnect → reconnecting → re-subscribed → config loaded

---

## Phase 7: CT-5 Thundering Herd After Recovery (Break → Fix → Verify)

**Cost:** Same replication group from Phase 5

### BREAK
- [ ] Start k6 at 500 RPS with 50 users
- [ ] Trigger failover → wait for recovery
- [ ] Watch first 10 seconds after Redis comes back

### What breaks
All rate limit keys expired during downtime. Every user gets a fresh full token bucket. Brief burst of ALL traffic being allowed — rate limiting temporarily defeated.

### FIX
- [ ] Modify `api-gateway/src/rate-limiter/rate-limiter.service.ts`:
  - On recovery (`redisHealthy` flips false → true): sync local fallback state back to Redis
  - For each user in fallback map, pre-populate their Redis token count
  - Prevents "fresh bucket" problem

### VERIFY
- [ ] Trigger failover under load → wait for recovery
- [ ] **Before:** allowed-requests spike in first 10s post-recovery
- [ ] **After:** smooth transition, local state synced to Redis, no spike

---

## Phase 8: ElastiCache Cluster Mode (Break → Observe)

**Cost:** ~$0.40 for 4 hours (6x cache.t3.micro). Tear down immediately after.

### Setup
- [ ] Create `deploy/setup-elasticache-cluster.sh` (3 shards, 1 replica each)
- [ ] Set `REDIS_CLUSTER_MODE=true` in compose override
- [ ] Redeploy app

### CT-1 (cluster): Shard Failover
- [ ] `aws elasticache test-failover --node-group-id 0001`
- [ ] Only users on that shard affected — others continue normally
- [ ] Fail-open from Phase 5 handles affected shard's users

### CT-7: Hot Shard (Observe — No Fix)
- [ ] Run k6 with 80% traffic to 5 users, 20% to 1000 users
- [ ] Watch per-shard CPU in CloudWatch — expect severe imbalance
- [ ] This is inherent to hash-based sharding with skewed traffic

### Outcome
Architectural observation: demonstrates why you'd use consistent hashing or key resharding in production.

---

## Phase 9: Teardown

- [ ] Create and run `deploy/teardown-elasticache.sh`
  - Delete replication groups / clusters
  - Delete cache subnet groups
  - Delete ElastiCache security group rules
- [ ] Run `deploy/teardown-ec2.sh` (existing script)
- [ ] Verify all AWS resources cleaned up

---

## Quick Reference

### Chaos Test Matrix
| # | Test | Phase | Infra | Fix |
|---|------|-------|-------|-----|
| CT-2 | Latency spike | 2 | Single node | Observe only (capacity limit) |
| CT-3 | Memory exhaustion | 3 | Single node | `maxmemory-policy: volatile-ttl` |
| CT-4 | Connection backpressure | 4 | Single node | ioredis `enableOfflineQueue: false` |
| CT-1 | Node death / failover | 5 | Replication | Fail-open + local fallback |
| CT-6 | Pub/sub disconnect | 6 | Replication | Reconnect handler + re-subscribe |
| CT-5 | Thundering herd | 7 | Replication | Sync local state to Redis on recovery |
| CT-1c | Shard failover | 8 | Cluster | Already fixed by Phase 5 |
| CT-7 | Hot shard | 8 | Cluster | Observe only (architectural) |

### Cost Summary
| Phases | Resources | Cost |
|--------|-----------|------|
| 0-4 | 1x EC2 + 1x ElastiCache | $0 (free tier) |
| 5-7 | + 1 ElastiCache replica | ~$12/month |
| 8 | 6 ElastiCache nodes | ~$0.40 for 4 hours |

### Key URLs (after deploy)
| Service | URL |
|---------|-----|
| API Gateway | `http://<EC2_IP>:8080/api/products` |
| Health Check | `http://<EC2_IP>:8080/health` |
| Grafana | `http://<EC2_IP>:3000/d/rate-limiter-red/` |
| Prometheus | `http://<EC2_IP>:9090` |
| Dashboard | `http://<EC2_IP>:3001` |
| Config API | `http://<EC2_IP>:8080/config/limits` |
