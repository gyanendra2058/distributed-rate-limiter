const AppState = (() => {
  const state = {
    userId: 'demo-user-1',
    algorithm: 'token-bucket',
  };

  const listeners = [];

  return {
    get(key) { return state[key]; },
    set(key, value) {
      state[key] = value;
      listeners.forEach(fn => fn(key, value));
    },
    subscribe(fn) { listeners.push(fn); },
  };
})();

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = {
    success: 'bg-emerald-600 border-emerald-500',
    error: 'bg-red-600 border-red-500',
    info: 'bg-blue-600 border-blue-500',
  };
  toast.className = `toast ${colors[type] || colors.info} border rounded-lg px-4 py-3 text-sm text-white shadow-lg max-w-sm`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
