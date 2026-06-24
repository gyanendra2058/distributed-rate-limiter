import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Token bucket metrics
const tbAccepted = new Counter('tb_accepted');
const tbRejected = new Counter('tb_rejected');
const tbRejectionRate = new Rate('tb_rejection_rate');
const tbLatency = new Trend('tb_latency', true);

// Sliding window metrics
const swAccepted = new Counter('sw_accepted');
const swRejected = new Counter('sw_rejected');
const swRejectionRate = new Rate('sw_rejection_rate');
const swLatency = new Trend('sw_latency', true);

export const options = {
  scenarios: {
    // Phase 1: Token bucket burst on /api/order
    token_bucket_burst: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'tokenBucketTest',
      startTime: '0s',
    },
    // Phase 2: Sliding window burst on /api/order (after clearing state)
    sliding_window_burst: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'slidingWindowTest',
      startTime: '15s',
    },
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

export function tokenBucketTest() {
  const res = http.post(
    `${BASE_URL}/api/order`,
    JSON.stringify({ items: ['comparison-test'] }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'comparison-tb-user',
      },
    },
  );

  tbLatency.add(res.timings.duration);
  if (res.status === 429) {
    tbRejected.add(1);
    tbRejectionRate.add(true);
  } else {
    tbAccepted.add(1);
    tbRejectionRate.add(false);
  }

  check(res, {
    'TB: valid response': (r) => r.status === 200 || r.status === 429,
    'TB: has rate limit header': (r) =>
      r.headers['X-Ratelimit-Algorithm'] === 'token-bucket',
  });
}

export function slidingWindowTest() {
  const res = http.post(
    `${BASE_URL}/api/order`,
    JSON.stringify({ items: ['comparison-test'] }),
    {
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': 'comparison-sw-user',
        'X-Rate-Limit-Algo': 'sliding-window',
      },
    },
  );

  swLatency.add(res.timings.duration);
  if (res.status === 429) {
    swRejected.add(1);
    swRejectionRate.add(true);
  } else {
    swAccepted.add(1);
    swRejectionRate.add(false);
  }

  check(res, {
    'SW: valid response': (r) => r.status === 200 || r.status === 429,
    'SW: has rate limit header': (r) =>
      r.headers['X-Ratelimit-Algorithm'] === 'sliding-window',
  });
}

export function handleSummary(data) {
  const tbAcc = data.metrics.tb_accepted ? data.metrics.tb_accepted.values.count : 0;
  const tbRej = data.metrics.tb_rejected ? data.metrics.tb_rejected.values.count : 0;
  const swAcc = data.metrics.sw_accepted ? data.metrics.sw_accepted.values.count : 0;
  const swRej = data.metrics.sw_rejected ? data.metrics.sw_rejected.values.count : 0;

  const tbP95 = data.metrics.tb_latency ? data.metrics.tb_latency.values['p(95)'] : 0;
  const swP95 = data.metrics.sw_latency ? data.metrics.sw_latency.values['p(95)'] : 0;

  const summary = `
╔══════════════════════════════════════════════════════════════╗
║              ALGORITHM COMPARISON RESULTS                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  TOKEN BUCKET                                                ║
║  ├─ Accepted:      ${String(tbAcc).padStart(6)}                              ║
║  ├─ Rejected:      ${String(tbRej).padStart(6)}                              ║
║  ├─ Rejection %:   ${String(((tbRej / (tbAcc + tbRej)) * 100).toFixed(1)).padStart(6)}%                             ║
║  └─ p95 Latency:   ${String(tbP95.toFixed(2)).padStart(6)}ms                            ║
║                                                              ║
║  SLIDING WINDOW LOG                                          ║
║  ├─ Accepted:      ${String(swAcc).padStart(6)}                              ║
║  ├─ Rejected:      ${String(swRej).padStart(6)}                              ║
║  ├─ Rejection %:   ${String(((swRej / (swAcc + swRej)) * 100).toFixed(1)).padStart(6)}%                             ║
║  └─ p95 Latency:   ${String(swP95.toFixed(2)).padStart(6)}ms                            ║
║                                                              ║
║  ANALYSIS                                                    ║
║  Sliding window is more precise — it tracks exact request    ║
║  timestamps vs token bucket's approximated refill. Token     ║
║  bucket allows brief bursts above the rate while sliding     ║
║  window enforces strict per-window counts.                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`;

  return {
    stdout: summary,
  };
}
