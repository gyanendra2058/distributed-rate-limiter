const ApiTester = (() => {
  const endpoints = [
    { key: 'products', label: 'Products', method: 'GET', path: '/api/products', color: 'blue', fn: o => ApiClient.getProducts(o) },
    { key: 'order', label: 'Create Order', method: 'POST', path: '/api/order', color: 'amber', fn: o => ApiClient.createOrder(o) },
    { key: 'checkout', label: 'Checkout', method: 'POST', path: '/api/checkout', color: 'purple', fn: o => ApiClient.checkout(o) },
  ];

  function init(container) {
    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        ${endpoints.map(ep => cardHTML(ep)).join('')}
      </div>
    `;

    endpoints.forEach(ep => {
      document.getElementById(`btn-${ep.key}`).addEventListener('click', () => fireSingle(ep));
      document.getElementById(`burst-btn-${ep.key}`).addEventListener('click', () => fireBurst(ep));
    });
  }

  function cardHTML(ep) {
    const methodColors = { GET: 'bg-emerald-500/20 text-emerald-400', POST: 'bg-amber-500/20 text-amber-400' };
    return `
      <div id="card-${ep.key}" class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
        <div class="p-5">
          <div class="flex items-center justify-between mb-4">
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono px-2 py-0.5 rounded ${methodColors[ep.method]}">${ep.method}</span>
              <span class="font-semibold">${ep.label}</span>
            </div>
            <span class="text-xs text-slate-500 font-mono">${ep.path}</span>
          </div>

          <!-- Rate Limit Info -->
          <div id="rl-info-${ep.key}" class="mb-4 p-3 bg-slate-900 rounded-lg text-sm hidden">
            <div class="flex items-center justify-between mb-2">
              <span class="text-slate-400">Rate Limit</span>
              <span id="rl-algo-${ep.key}" class="text-xs bg-slate-700 px-2 py-0.5 rounded"></span>
            </div>
            <div class="w-full bg-slate-700 rounded-full h-2 mb-2">
              <div id="rl-bar-${ep.key}" class="bg-emerald-500 h-2 rounded-full transition-all duration-300" style="width: 100%"></div>
            </div>
            <div class="flex justify-between text-xs text-slate-400">
              <span>Remaining: <span id="rl-remaining-${ep.key}" class="text-slate-200">-</span> / <span id="rl-limit-${ep.key}" class="text-slate-200">-</span></span>
              <span>Refill: <span id="rl-refill-${ep.key}" class="text-slate-200">-</span></span>
            </div>
          </div>

          <!-- Actions -->
          <div class="flex gap-2 mb-4">
            <button id="btn-${ep.key}" class="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium py-2 px-4 rounded-lg transition-colors">
              Send Request
            </button>
            <button id="burst-btn-${ep.key}" class="bg-slate-700 hover:bg-slate-600 text-sm py-2 px-3 rounded-lg transition-colors flex items-center gap-2">
              Burst
              <input id="burst-count-${ep.key}" type="number" value="10" min="1" max="50"
                class="w-12 bg-slate-600 border border-slate-500 rounded px-1 py-0.5 text-center text-xs"
                onclick="event.stopPropagation()">
            </button>
          </div>

          <!-- Burst Timeline -->
          <div id="burst-timeline-${ep.key}" class="mb-4 hidden">
            <div class="text-xs text-slate-400 mb-2">Burst Timeline <span id="burst-stats-${ep.key}"></span></div>
            <div id="burst-dots-${ep.key}" class="flex flex-wrap gap-1"></div>
          </div>

          <!-- Response -->
          <div id="response-${ep.key}" class="response-box bg-slate-900 rounded-lg p-3 text-xs font-mono text-slate-400 hidden">
            <pre id="response-body-${ep.key}" class="whitespace-pre-wrap"></pre>
          </div>
        </div>

        <!-- Status Bar -->
        <div id="status-bar-${ep.key}" class="h-1 bg-slate-700 transition-colors"></div>
      </div>
    `;
  }

  function updateRateLimitDisplay(ep, rateLimit, status) {
    const infoEl = document.getElementById(`rl-info-${ep.key}`);
    infoEl.classList.remove('hidden');

    if (rateLimit.algorithm) {
      document.getElementById(`rl-algo-${ep.key}`).textContent = rateLimit.algorithm;
    }
    if (rateLimit.remaining !== null && rateLimit.limit !== null) {
      const remaining = parseInt(rateLimit.remaining);
      const limit = parseInt(rateLimit.limit);
      document.getElementById(`rl-remaining-${ep.key}`).textContent = remaining;
      document.getElementById(`rl-limit-${ep.key}`).textContent = limit;
      const pct = limit > 0 ? (remaining / limit) * 100 : 0;
      const bar = document.getElementById(`rl-bar-${ep.key}`);
      bar.style.width = pct + '%';
      bar.className = `h-2 rounded-full transition-all duration-300 ${pct > 30 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-red-500'}`;
    }
    if (rateLimit.refillRate) {
      document.getElementById(`rl-refill-${ep.key}`).textContent = rateLimit.refillRate;
    }

    const card = document.getElementById(`card-${ep.key}`);
    const statusBar = document.getElementById(`status-bar-${ep.key}`);
    if (status === 429) {
      card.classList.add('flash-reject');
      statusBar.className = 'h-1 bg-red-500 transition-colors';
      setTimeout(() => card.classList.remove('flash-reject'), 400);
    } else {
      card.classList.add('flash-allow');
      statusBar.className = 'h-1 bg-emerald-500 transition-colors';
      setTimeout(() => { card.classList.remove('flash-allow'); statusBar.className = 'h-1 bg-slate-700 transition-colors'; }, 600);
    }
  }

  async function fireSingle(ep) {
    const btn = document.getElementById(`btn-${ep.key}`);
    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
      const result = await ep.fn();
      updateRateLimitDisplay(ep, result.rateLimit, result.status);

      const responseEl = document.getElementById(`response-${ep.key}`);
      const bodyEl = document.getElementById(`response-body-${ep.key}`);
      responseEl.classList.remove('hidden');
      bodyEl.textContent = `HTTP ${result.status}\n${JSON.stringify(result.data, null, 2)}`;
    } catch (err) {
      showToast('Request failed: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Request';
    }
  }

  async function fireBurst(ep) {
    const count = parseInt(document.getElementById(`burst-count-${ep.key}`).value) || 10;
    const btn = document.getElementById(`burst-btn-${ep.key}`);
    const timelineEl = document.getElementById(`burst-timeline-${ep.key}`);
    const dotsEl = document.getElementById(`burst-dots-${ep.key}`);
    const statsEl = document.getElementById(`burst-stats-${ep.key}`);

    btn.disabled = true;
    timelineEl.classList.remove('hidden');
    dotsEl.innerHTML = Array.from({ length: count }, () => '<span class="burst-dot pending"></span>').join('');

    let accepted = 0;
    let rejected = 0;

    for (let i = 0; i < count; i++) {
      try {
        const result = await ep.fn();
        const dot = dotsEl.children[i];

        if (result.status === 429) {
          dot.className = 'burst-dot rejected';
          dot.title = `#${i + 1}: 429 — Retry after ${result.rateLimit.retryAfter || '?'}s`;
          rejected++;
        } else {
          dot.className = 'burst-dot success';
          dot.title = `#${i + 1}: ${result.status} — Remaining: ${result.rateLimit.remaining}`;
          accepted++;
        }

        updateRateLimitDisplay(ep, result.rateLimit, result.status);
        statsEl.textContent = `(${accepted} accepted, ${rejected} rejected)`;
      } catch (err) {
        const dot = dotsEl.children[i];
        dot.className = 'burst-dot rejected';
        dot.title = `#${i + 1}: Error — ${err.message}`;
        rejected++;
      }
    }

    btn.disabled = false;
  }

  return { init };
})();
