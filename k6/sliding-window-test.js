import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const rejected = new Counter('rate_limit_429s');
const accepted = new Counter('rate_limit_200s');
const rejectionRate = new Rate('rejection_rate');

export const options = {
  scenarios: {
    burst_order: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'testOrder',
    },
    burst_products: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'testProducts',
    },
    burst_checkout: {
      executor: 'constant-arrival-rate',
      rate: 200,
      timeUnit: '1s',
      duration: '10s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      exec: 'testCheckout',
    },
  },
  thresholds: {
    'rate_limit_429s': ['count>0'],
    'rejection_rate': ['rate>0.5'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

function getHeaders() {
  return {
    'Content-Type': 'application/json',
    'X-User-Id': 'user-1',
    'X-Rate-Limit-Algo': 'sliding-window',
  };
}

function trackResult(res) {
  if (res.status === 429) {
    rejected.add(1);
    rejectionRate.add(true);
  } else {
    accepted.add(1);
    rejectionRate.add(false);
  }
  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}

export function testOrder() {
  const res = http.post(
    `${BASE_URL}/api/order`,
    JSON.stringify({ items: ['item-1'] }),
    { headers: getHeaders() },
  );
  trackResult(res);
}

export function testProducts() {
  const res = http.get(`${BASE_URL}/api/products`, { headers: getHeaders() });
  trackResult(res);
}

export function testCheckout() {
  const res = http.post(
    `${BASE_URL}/api/checkout`,
    JSON.stringify({ total: 99.99 }),
    { headers: getHeaders() },
  );
  trackResult(res);
}
