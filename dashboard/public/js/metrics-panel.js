const MetricsPanel = (() => {
  let container;
  let refreshInterval = null;
  let rateChart = null;

  function init(el) {
    container = el;
    container.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold">Live Metrics</h2>
            <p class="text-sm text-slate-400 mt-1">Real-time data from Prometheus. Auto-refreshes every 5s.</p>
          </div>
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span id="metrics-last-updated" class="text-xs text-slate-500">--</span>
          </div>
        </div>

        <!-- Summary Tiles -->
        <div id="metrics-tiles" class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div class="text-xs text-slate-400 mb-1">Total Hits</div>
            <div id="tile-hits" class="text-2xl font-bold text-emerald-400">--</div>
          </div>
          <div class="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div class="text-xs text-slate-400 mb-1">Total Rejections</div>
            <div id="tile-rejections" class="text-2xl font-bold text-red-400">--</div>
          </div>
          <div class="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div class="text-xs text-slate-400 mb-1">Acceptance Rate</div>
            <div id="tile-acceptance" class="text-2xl font-bold text-blue-400">--</div>
          </div>
          <div class="bg-slate-800 rounded-xl border border-slate-700 p-4">
            <div class="text-xs text-slate-400 mb-1">Active Endpoints</div>
            <div id="tile-endpoints" class="text-2xl font-bold text-amber-400">--</div>
          </div>
        </div>

        <!-- Rate Chart -->
        <div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 class="text-sm font-medium text-slate-300 mb-4">Request Rate (last 5 min)</h3>
          <div style="height: 250px;">
            <canvas id="rate-chart"></canvas>
          </div>
        </div>

        <!-- Per-Endpoint Breakdown -->
        <div class="bg-slate-800 rounded-xl border border-slate-700 p-5">
          <h3 class="text-sm font-medium text-slate-300 mb-4">Per-Endpoint Breakdown</h3>
          <div id="endpoint-breakdown" class="space-y-3"></div>
        </div>
      </div>
    `;
  }

  function onShow() {
    fetchAndRender();
    refreshInterval = setInterval(fetchAndRender, 5000);
  }

  function onHide() {
    if (refreshInterval) {
      clearInterval(refreshInterval);
      refreshInterval = null;
    }
  }

  async function fetchAndRender() {
    try {
      const [hitsRes, rejectionsRes] = await Promise.all([
        ApiClient.queryPrometheus('sum(rate_limit_hits_total) by (endpoint)'),
        ApiClient.queryPrometheus('sum(rate_limit_rejections_total) by (endpoint)'),
      ]);

      const hits = parseMetricResult(hitsRes);
      const rejections = parseMetricResult(rejectionsRes);

      const totalHits = Object.values(hits).reduce((a, b) => a + b, 0);
      const totalRejections = Object.values(rejections).reduce((a, b) => a + b, 0);
      const acceptanceRate = totalHits > 0 ? (((totalHits - totalRejections) / totalHits) * 100).toFixed(1) : '--';

      document.getElementById('tile-hits').textContent = Math.round(totalHits);
      document.getElementById('tile-rejections').textContent = Math.round(totalRejections);
      document.getElementById('tile-acceptance').textContent = acceptanceRate !== '--' ? acceptanceRate + '%' : '--';
      document.getElementById('tile-endpoints').textContent = Object.keys(hits).length || '--';
      document.getElementById('metrics-last-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();

      renderBreakdown(hits, rejections);
      await renderRateChart();
    } catch (err) {
      document.getElementById('metrics-last-updated').textContent = 'Error: ' + err.message;
    }
  }

  function parseMetricResult(res) {
    const result = {};
    if (res?.data?.result) {
      res.data.result.forEach(r => {
        result[r.metric.endpoint || 'unknown'] = parseFloat(r.value[1]) || 0;
      });
    }
    return result;
  }

  function renderBreakdown(hits, rejections) {
    const el = document.getElementById('endpoint-breakdown');
    const endpoints = new Set([...Object.keys(hits), ...Object.keys(rejections)]);

    if (endpoints.size === 0) {
      el.innerHTML = '<div class="text-sm text-slate-500">No data yet. Send some requests first.</div>';
      return;
    }

    el.innerHTML = Array.from(endpoints).map(ep => {
      const h = Math.round(hits[ep] || 0);
      const r = Math.round(rejections[ep] || 0);
      const total = h || 1;
      const acceptPct = ((h - r) / total * 100).toFixed(0);
      const rejectPct = (r / total * 100).toFixed(0);

      return `
        <div class="flex items-center gap-4">
          <span class="font-mono text-sm w-24 text-slate-300">${ep}</span>
          <div class="flex-1 flex h-4 rounded-full overflow-hidden bg-slate-700">
            <div class="bg-emerald-500 transition-all" style="width: ${acceptPct}%"></div>
            <div class="bg-red-500 transition-all" style="width: ${rejectPct}%"></div>
          </div>
          <span class="text-xs text-slate-400 w-32 text-right">${h - r} accepted / ${r} rejected</span>
        </div>
      `;
    }).join('');
  }

  async function renderRateChart() {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 300;

    try {
      const [hitsRange, rejectRange] = await Promise.all([
        ApiClient.queryPrometheusRange('sum(rate(rate_limit_hits_total[30s]))', start, now, 5),
        ApiClient.queryPrometheusRange('sum(rate(rate_limit_rejections_total[30s]))', start, now, 5),
      ]);

      const hitsData = hitsRange?.data?.result?.[0]?.values || [];
      const rejectData = rejectRange?.data?.result?.[0]?.values || [];

      const labels = hitsData.map(v => new Date(v[0] * 1000).toLocaleTimeString());
      const hitsValues = hitsData.map(v => parseFloat(v[1]) || 0);
      const rejectValues = rejectData.map(v => parseFloat(v[1]) || 0);

      const canvas = document.getElementById('rate-chart');
      const ctx = canvas.getContext('2d');

      if (rateChart) {
        rateChart.data.labels = labels;
        rateChart.data.datasets[0].data = hitsValues;
        rateChart.data.datasets[1].data = rejectValues;
        rateChart.update('none');
      } else {
        rateChart = new Chart(ctx, {
          type: 'line',
          data: {
            labels,
            datasets: [
              {
                label: 'Hits/sec',
                data: hitsValues,
                borderColor: '#34d399',
                backgroundColor: 'rgba(52, 211, 153, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
              },
              {
                label: 'Rejections/sec',
                data: rejectValues,
                borderColor: '#ef4444',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fill: true,
                tension: 0.3,
                pointRadius: 0,
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
                ticks: { color: '#64748b', maxTicksLimit: 10, font: { size: 10 } },
                grid: { color: '#1e293b' },
              },
              y: {
                ticks: { color: '#64748b', font: { size: 10 } },
                grid: { color: '#1e293b' },
                beginAtZero: true,
              },
            },
          },
        });
      }
    } catch {
      // Prometheus might not have range data yet
    }
  }

  return { init, onShow, onHide };
})();
