import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const rejected = new Counter('rate_limit_429s');
const accepted = new Counter('rate_limit_200s');
const errors = new Counter('http_errors_5xx');
const rejectionRate = new Rate('rejection_rate');

// 10K unique users to exhaust cache.t3.micro memory (0.5 GB)
const TOTAL_USERS = 10000;

export const options = {
  scenarios: {
    memory_pressure: {
      executor: 'constant-arrival-rate',
      rate: 500,
      timeUnit: '1s',
      duration: '5m',
      preAllocatedVUs: 100,
      maxVUs: 300,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<200'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

let requestCounter = 0;

export default function () {
  const userId = `user-${requestCounter++ % TOTAL_USERS}`;
  const headers = {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  };

  const rand = Math.random();
  let res;
  if (rand < 0.6) {
    res = http.get(`${BASE_URL}/api/products`, { headers });
  } else if (rand < 0.9) {
    res = http.post(
      `${BASE_URL}/api/order`,
      JSON.stringify({ items: ['item-1'] }),
      { headers },
    );
  } else {
    res = http.post(
      `${BASE_URL}/api/checkout`,
      JSON.stringify({ total: 99.99 }),
      { headers },
    );
  }

  if (res.status === 429) {
    rejected.add(1);
    rejectionRate.add(true);
  } else if (res.status >= 500) {
    errors.add(1);
    rejectionRate.add(false);
  } else {
    accepted.add(1);
    rejectionRate.add(false);
  }

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}
