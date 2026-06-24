const AdminPanel = (() => {
  let container;

  function init(el) {
    container = el;
    container.innerHTML = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-lg font-semibold">Rate Limit Configuration</h2>
            <p class="text-sm text-slate-400 mt-1">Update limits for any endpoint. Changes propagate to all gateway pods via Redis pub/sub.</p>
          </div>
          <button id="admin-refresh-btn" class="bg-slate-700 hover:bg-slate-600 text-sm py-2 px-4 rounded-lg transition-colors">
            Refresh
          </button>
        </div>

        <div id="admin-table-container" class="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
          <div class="p-8 text-center text-slate-400">Loading configuration...</div>
        </div>
      </div>
    `;

    document.getElementById('admin-refresh-btn').addEventListener('click', refresh);
    refresh();
  }

  async function refresh() {
    const tableContainer = document.getElementById('admin-table-container');
    try {
      const limits = await ApiClient.getConfigLimits();
      renderTable(limits, tableContainer);
    } catch (err) {
      tableContainer.innerHTML = `<div class="p-8 text-center text-red-400">Failed to load: ${err.message}</div>`;
    }
  }

  function renderTable(raw, tableContainer) {
    const limits = Array.isArray(raw)
      ? raw
      : Object.entries(raw).map(([endpoint, cfg]) => ({ endpoint, ...cfg }));
    const rows = limits.map(l => `
      <tr class="border-t border-slate-700" id="row-${l.endpoint}">
        <td class="px-5 py-4">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span class="font-mono text-sm">${l.endpoint}</span>
          </div>
        </td>
        <td class="px-5 py-4">
          <input type="number" value="${l.maxTokens}" data-field="maxTokens" data-endpoint="${l.endpoint}"
            class="config-input bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-emerald-500">
        </td>
        <td class="px-5 py-4">
          <input type="number" value="${l.refillRate}" data-field="refillRate" data-endpoint="${l.endpoint}"
            class="config-input bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm w-20 focus:outline-none focus:ring-2 focus:ring-emerald-500">
        </td>
        <td class="px-5 py-4">
          <select data-field="refillRateUnit" data-endpoint="${l.endpoint}"
            class="config-input bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
            <option value="second" ${l.refillRateUnit === 'second' ? 'selected' : ''}>second</option>
            <option value="minute" ${l.refillRateUnit === 'minute' ? 'selected' : ''}>minute</option>
            <option value="hour" ${l.refillRateUnit === 'hour' ? 'selected' : ''}>hour</option>
          </select>
        </td>
        <td class="px-5 py-4">
          <input type="number" value="${l.windowSizeMs}" data-field="windowSizeMs" data-endpoint="${l.endpoint}"
            class="config-input bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-emerald-500">
        </td>
        <td class="px-5 py-4">
          <button class="save-btn bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium py-1.5 px-4 rounded-lg transition-colors"
            data-endpoint="${l.endpoint}">
            Save
          </button>
        </td>
      </tr>
    `).join('');

    tableContainer.innerHTML = `
      <table class="w-full text-sm">
        <thead>
          <tr class="text-left text-slate-400 text-xs uppercase tracking-wider">
            <th class="px-5 py-3">Endpoint</th>
            <th class="px-5 py-3">Max Tokens</th>
            <th class="px-5 py-3">Refill Rate</th>
            <th class="px-5 py-3">Refill Unit</th>
            <th class="px-5 py-3">Window (ms)</th>
            <th class="px-5 py-3">Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    tableContainer.querySelectorAll('.save-btn').forEach(btn => {
      btn.addEventListener('click', () => saveEndpoint(btn.dataset.endpoint));
    });
  }

  async function saveEndpoint(endpoint) {
    const row = document.getElementById(`row-${endpoint}`);
    const inputs = row.querySelectorAll('.config-input');
    const config = {};

    inputs.forEach(input => {
      const field = input.dataset.field;
      config[field] = input.type === 'number' ? parseInt(input.value) : input.value;
    });

    const btn = row.querySelector('.save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
      await ApiClient.updateConfigLimit(endpoint, config);
      showToast(`Updated "${endpoint}" limits. Changes propagated to all gateway pods via Redis pub/sub.`);
      btn.textContent = 'Saved!';
      setTimeout(() => { btn.textContent = 'Save'; btn.disabled = false; }, 1500);
    } catch (err) {
      showToast('Failed to save: ' + err.message, 'error');
      btn.textContent = 'Save';
      btn.disabled = false;
    }
  }

  return { init, refresh };
})();
