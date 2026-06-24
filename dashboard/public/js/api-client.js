const ApiClient = (() => {
  function parseRateLimitHeaders(headers) {
    return {
      limit: headers.get('x-ratelimit-limit'),
      remaining: headers.get('x-ratelimit-remaining'),
      algorithm: headers.get('x-ratelimit-algorithm'),
      refillRate: headers.get('x-ratelimit-refillrate'),
      retryAfter: headers.get('retry-after'),
    };
  }

  async function request(method, path, body, overrides = {}) {
    const headers = {
      'Content-Type': 'application/json',
      'X-User-Id': overrides.userId || AppState.get('userId'),
      'X-Rate-Limit-Algo': overrides.algorithm || AppState.get('algorithm'),
    };

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);
    const rateLimit = parseRateLimitHeaders(res.headers);

    let data;
    try { data = await res.json(); } catch { data = null; }

    return { status: res.status, data, rateLimit };
  }

  return {
    getProducts(overrides) {
      return request('GET', '/api/products', null, overrides);
    },
    createOrder(overrides) {
      return request('POST', '/api/order', { items: ['item-1', 'item-2'] }, overrides);
    },
    checkout(overrides) {
      return request('POST', '/api/checkout', { total: 99.99 }, overrides);
    },

    async getConfigLimits() {
      const res = await fetch('/config/limits');
      return res.json();
    },
    async getConfigLimit(endpoint) {
      const res = await fetch('/config/limits/' + endpoint);
      return res.json();
    },
    async updateConfigLimit(endpoint, config) {
      const res = await fetch('/config/limits/' + endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      return res.json();
    },

    async queryPrometheus(query) {
      const res = await fetch('/prometheus/api/v1/query?query=' + encodeURIComponent(query));
      return res.json();
    },
    async queryPrometheusRange(query, start, end, step) {
      const params = new URLSearchParams({ query, start, end, step });
      const res = await fetch('/prometheus/api/v1/query_range?' + params);
      return res.json();
    },
  };
})();
