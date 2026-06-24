const AlgoComparison = (() => {
  let container;
  let remainingChart = null;

  function init(el) {
    container = el;
    container.innerHTML = `
      <div class="space-y-6">
        <div>
          <h2 class="text-lg font-semibold">Algorithm Comparison</h2>
          <p class="text-sm text-slate-400 mt-1">Run side-by-side burst tests to see how Token Bucket and Sliding Window behave differently.</p>
        </div>

        <!-- Controls -->
        <div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <div class="flex flex-wrap items-end gap-4">
            <div>
              <label class="block text-xs text-slate-400 mb-1">Endpoint</label>
              <select id="cmp-endpoint" class="bg-slate-700 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="products">products (limit: 20)</option>
                <option value="order">order (limit: 5)</option>
                <option value="checkout" selected>checkout (limit: 3)</option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-slate-400 mb-1">Burst Count</label>
              <input id="cmp-count" type="range" min="5" max="50" value="15" class="w-40 accent-emerald-500">
              <span id="cmp-count-label" class="text-sm text-slate-300 ml-2">15</span>
            </div>
            <button id="cmp-run-btn" class="bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium py-2 px-6 rounded-lg transition-colors">
              Run Comparison
            </button>
          </div>
        </div>

        <!-- Results -->
        <div id="cmp-results" class="hidden">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- Token Bucket Column -->
            <div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <div class="flex items-center gap-2 mb-4">
                <span class="w-3 h-3 rounded-full bg-blue-500"></span>
                <h3 class="font-semibold">Token Bucket</h3>
              </div>
              <div id="cmp-tb-dots" class="flex flex-wrap gap-1 mb-3"></div>
              <div id="cmp-tb-stats" class="text-sm text-slate-400"></div>
            </div>

            <!-- Sliding Window Column -->
            <div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
              <div class="flex items-center gap-2 mb-4">
                <span class="w-3 h-3 rounded-full bg-purple-500"></span>
                <h3 class="font-semibold">Sliding Window</h3>
              </div>
              <div id="cmp-sw-dots" class="flex flex-wrap gap-1 mb-3"></div>
              <div id="cmp-sw-stats" class="text-sm text-slate-400"></div>
            </div>
          </div>

          <!-- Remaining Tokens Chart -->
          <div class="bg-slate-800 rounded-xl border border-slate-700 p-5 mt-6">
            <h3 class="text-sm font-medium text-slate-300 mb-4">Remaining Tokens Over Requests</h3>
            <div style="height: 250px;">
              <canvas id="remaining-chart"></canvas>
            </div>
          </div>

          <!-- Explanation -->
          <div id="cmp-explanation" class="bg-slate-800/50 rounded-xl border border-slate-700 p-5 mt-6">
          </div>
        </div>
      </div>
    `;

    document.getElementById('cmp-count').addEventListener('input', e => {
      document.getElementById('cmp-count-label').textContent = e.target.value;
    });
    document.getElementById('cmp-run-btn').addEventListener('click', runComparison);
  }

  async function runBurst(endpoint, count, algorithm, userId) {
    const results = [];
    const endpointFns = {
      products: o => ApiClient.getProducts(o),
      order: o => ApiClient.createOrder(o),
      checkout: o => ApiClient.checkout(o),
    };
    const fn = endpointFns[endpoint];

    for (let i = 0; i < count; i++) {
      try {
        const result = await fn({ userId, algorithm });
        results.push({
          index: i,
          status: result.status,
          remaining: parseInt(result.rateLimit.remaining) || 0,
          retryAfter: result.rateLimit.retryAfter,
        });
      } catch {
        results.push({ index: i, status: 0, remaining: 0, retryAfter: null });
      }
    }
    return results;
  }

  function renderDots(results, containerId) {
    const el = document.getElementById(containerId);
    el.innerHTML = results.map((r, i) => {
      const cls = r.status === 429 ? 'rejected' : r.status === 0 ? 'rejected' : 'success';
      return `<span class="burst-dot ${cls}" title="#${i + 1}: HTTP ${r.status}, remaining: ${r.remaining}"></span>`;
    }).join('');
  }

  function renderStats(results, containerId) {
    const accepted = results.filter(r => r.status !== 429 && r.status !== 0).length;
    const rejected = results.length - accepted;
    const firstReject = results.findIndex(r => r.status === 429);
    const el = document.getElementById(containerId);
    el.innerHTML = `
      <span class="text-emerald-400">${accepted} accepted</span> /
      <span class="text-red-400">${rejected} rejected</span>
      ${firstReject >= 0 ? ` &mdash; First rejection at request #${firstReject + 1}` : ''}
    `;
  }

  function renderChart(tbResults, swResults) {
    const canvas = document.getElementById('remaining-chart');
    const ctx = canvas.getContext('2d');
    const labels = tbResults.map((_, i) => i + 1);

    if (remainingChart) remainingChart.destroy();

    remainingChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Token Bucket — Remaining',
            data: tbResults.map(r => r.remaining),
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            tension: 0.2,
            pointRadius: 3,
            pointBackgroundColor: tbResults.map(r => r.status === 429 ? '#ef4444' : '#3b82f6'),
          },
          {
            label: 'Sliding Window — Remaining',
            data: swResults.map(r => r.remaining),
            borderColor: '#a855f7',
            backgroundColor: 'rgba(168, 85, 247, 0.1)',
            fill: true,
            tension: 0.2,
            pointRadius: 3,
            pointBackgroundColor: swResults.map(r => r.status === 429 ? '#ef4444' : '#a855f7'),
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        },
        scales: {
          x: {
            title: { display: true, text: 'Request #', color: '#64748b' },
            ticks: { color: '#64748b' },
            grid: { color: '#1e293b' },
          },
          y: {
            title: { display: true, text: 'Remaining', color: '#64748b' },
            ticks: { color: '#64748b' },
            grid: { color: '#1e293b' },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function renderExplanation(tbResults, swResults, endpoint) {
    const tbAccepted = tbResults.filter(r => r.status !== 429 && r.status !== 0).length;
    const swAccepted = swResults.filter(r => r.status !== 429 && r.status !== 0).length;
    const el = document.getElementById('cmp-explanation');

    el.innerHTML = `
      <h3 class="font-semibold text-slate-200 mb-3">What happened?</h3>
      <div class="space-y-2 text-sm text-slate-400">
        <p>
          <span class="text-blue-400 font-medium">Token Bucket</span> accepted
          <span class="text-slate-200 font-medium">${tbAccepted}</span> requests.
          It starts with a full bucket of <em>maxTokens</em> and drains one token per request.
          Once empty, requests are rejected until tokens refill at the configured rate.
          This allows short bursts up to the bucket capacity.
        </p>
        <p>
          <span class="text-purple-400 font-medium">Sliding Window</span> accepted
          <span class="text-slate-200 font-medium">${swAccepted}</span> requests.
          It tracks exact timestamps of each request within the window and enforces a strict
          count of <em>maxTokens</em> requests per window. No burst allowance — once the
          limit is hit within the window, all further requests are rejected until older
          entries expire.
        </p>
        ${tbAccepted !== swAccepted ? `
        <p class="text-slate-300 bg-slate-700/50 p-3 rounded-lg mt-3">
          The difference of <strong>${Math.abs(tbAccepted - swAccepted)}</strong> requests shows that
          ${tbAccepted > swAccepted
            ? 'Token Bucket is more burst-friendly — ideal for traffic with natural spikes.'
            : 'Sliding Window is stricter — better for APIs that need precise rate enforcement.'}
        </p>` : ''}
      </div>
    `;
  }

  async function runComparison() {
    const endpoint = document.getElementById('cmp-endpoint').value;
    const count = parseInt(document.getElementById('cmp-count').value);
    const btn = document.getElementById('cmp-run-btn');
    const resultsEl = document.getElementById('cmp-results');

    btn.disabled = true;
    btn.textContent = 'Running Token Bucket...';
    resultsEl.classList.remove('hidden');

    document.getElementById('cmp-tb-dots').innerHTML = Array.from({ length: count }, () => '<span class="burst-dot pending"></span>').join('');
    document.getElementById('cmp-sw-dots').innerHTML = Array.from({ length: count }, () => '<span class="burst-dot pending"></span>').join('');
    document.getElementById('cmp-tb-stats').textContent = '';
    document.getElementById('cmp-sw-stats').textContent = '';

    const tbResults = await runBurst(endpoint, count, 'token-bucket', 'compare-tb-' + Date.now());
    renderDots(tbResults, 'cmp-tb-dots');
    renderStats(tbResults, 'cmp-tb-stats');

    btn.textContent = 'Running Sliding Window...';

    const swResults = await runBurst(endpoint, count, 'sliding-window', 'compare-sw-' + Date.now());
    renderDots(swResults, 'cmp-sw-dots');
    renderStats(swResults, 'cmp-sw-stats');

    renderChart(tbResults, swResults);
    renderExplanation(tbResults, swResults, endpoint);

    btn.disabled = false;
    btn.textContent = 'Run Comparison';
  }

  return { init };
})();
