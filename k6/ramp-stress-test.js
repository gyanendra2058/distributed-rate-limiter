import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const rejected = new Counter('rate_limit_429s');
const accepted = new Counter('rate_limit_200s');
const errors = new Counter('http_errors_5xx');
const rejectionRate = new Rate('rejection_rate');

export const options = {
  scenarios: {
    ramp_load: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: 100,
      maxVUs: 500,
      stages: [
        { target: 100, duration: '60s' },
        { target: 500, duration: '30s' },
        { target: 500, duration: '60s' },
        { target: 1000, duration: '30s' },
        { target: 1000, duration: '60s' },
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<100', 'p(99)<250'],
    rate_limit_429s: ['count>0'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

function getHeaders(vuId) {
  const userId = `user-${vuId % 50}`;
  return {
    'Content-Type': 'application/json',
    'X-User-Id': userId,
  };
}

function recordResult(res) {
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
}

export default function () {
  const headers = getHeaders(__VU);
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

  recordResult(res);

  check(res, {
    'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}
