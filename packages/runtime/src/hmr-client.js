(function() {
  var host = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/_vesk/hmr';
  var ws = null;
  var status = 'loading';
  var errorMsg = '';
  var lastCompileMs = 0;
  var reconnectTimer = null;
  var lastUpdateTime = 0;

  function connect() {
    try {
      ws = new WebSocket(host);
      ws.onopen = function() {
        status = 'connected';
        updateUI();
      };
      ws.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          switch (msg.type) {
            case 'update':
              if (msg.fnSources) {
                var _eval = globalThis.__vesk_hmr_eval || function(c) { try { return eval(c) } catch(ex) { console.error('HMR eval error:', ex) } };
                Object.values(msg.fnSources).forEach(function(fn) { _eval(fn) });
              }
              globalThis.__updatedComponents = new Set(Object.keys(msg.components || {}));
              var router = globalThis.__vesk_router;
              if (router && typeof router.hmrUpdate === 'function') {
                router.hmrUpdate();
              }
              lastCompileMs = msg.time || 0;
              lastUpdateTime = Date.now();
              status = 'connected';
              updateUI();
              break;
            case 'reload':
              window.location.reload();
              break;
            case 'error':
              status = 'error';
              errorMsg = msg.message || 'Unknown error';
              updateUI();
              break;
            case 'css-update':
              document.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
                el.href = el.href.split('?')[0] + '?t=' + Date.now();
              });
              status = 'connected';
              updateUI();
              break;
            case 'compiling':
              status = 'compiling';
              updateUI();
              break;
          }
        } catch(ex) { /* ignore bad messages */ }
      };
      ws.onclose = function() {
        status = 'disconnected';
        updateUI();
        scheduleReconnect();
      };
      ws.onerror = function() {
        status = 'disconnected';
        updateUI();
        scheduleReconnect();
      };
    } catch(ex) { /* WebSocket unavailable */ }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  }

  var menu = null;
  var dot = null;
  var statusEl = null;
  var timeEl = null;
  var errorEl = null;

  function createMenu() {
    if (document.getElementById('__vesk_dev')) return;
    menu = document.createElement('div');
    menu.id = '__vesk_dev';
    menu.innerHTML =
      '<style>' +
      '#__vesk_dev{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:ui-monospace,monospace;font-size:11px;line-height:1.4;color:#e0e0e0;cursor:pointer;}' +
      '#__vesk_dev *{box-sizing:border-box;}' +
      '#__vesk_dev .__v_bar{display:flex;align-items:center;gap:8px;background:#1a1b26;border:1px solid #2a2b3e;border-radius:10px;padding:6px 12px;box-shadow:0 4px 24px rgba(0,0,0,0.6);position:relative;transition:all .2s;}' +
      '#__vesk_dev .__v_bar:hover{border-color:#3a3b5e;}' +
      '#__vesk_dev .__v_dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:background .3s;}' +
      '#__vesk_dev .__v_dot.connected{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,0.5);}' +
      '#__vesk_dev .__v_dot.compiling{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,0.5);animation:__v_pulse .8s infinite;}' +
      '#__vesk_dev .__v_dot.error{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,0.5);}' +
      '#__vesk_dev .__v_dot.disconnected{background:#6b7280;}' +
      '#__vesk_dev .__v_dot.loading{background:#6b7280;animation:__v_pulse 1.2s infinite;}' +
      '#__vesk_dev .__v_label{white-space:nowrap;}' +
      '#__vesk_dev .__v_detail{display:none;position:absolute;bottom:calc(100% + 8px);right:0;background:#1a1b26;border:1px solid #2a2b3e;border-radius:8px;padding:10px 14px;min-width:260px;box-shadow:0 4px 24px rgba(0,0,0,0.6);white-space:pre-wrap;word-break:break-all;font-size:11px;}' +
      '#__vesk_dev .__v_bar.open .__v_detail{display:block;}' +
      '#__vesk_dev .__v_detail_row{display:flex;justify-content:space-between;gap:12px;padding:2px 0;}' +
      '#__vesk_dev .__v_detail_label{color:#888;}' +
      '#__vesk_dev .__v_detail_val{color:#e0e0e0;text-align:right;}' +
      '#__vesk_dev .__v_error{color:#ef4444;font-size:11px;margin-top:4px;max-width:280px;overflow:hidden;text-overflow:ellipsis;}' +
      '#__vesk_dev .__v_version{position:absolute;top:8px;right:10px;font-size:9px;color:#555;}' +
      '@keyframes __v_pulse{0%,100%{opacity:1}50%{opacity:.4}}' +
      '</style>' +
      '<div class="__v_bar">' +
      '  <span class="__v_dot loading"></span>' +
      '  <span class="__v_label">Vesk</span>' +
      '  <span class="__v_version">dev</span>' +
      '  <div class="__v_detail">' +
      '    <div class="__v_detail_row"><span class="__v_detail_label">Status</span><span class="__v_detail_val" id="__v_status">connecting...</span></div>' +
      '    <div class="__v_detail_row"><span class="__v_detail_label">Compile</span><span class="__v_detail_val" id="__v_time">-</span></div>' +
      '    <div class="__v_error" id="__v_error"></div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(menu);

    var bar = menu.querySelector('.__v_bar');
    bar.addEventListener('click', function(e) {
      e.stopPropagation();
      bar.classList.toggle('open');
    });

    dot = menu.querySelector('.__v_dot');
    statusEl = document.getElementById('__v_status');
    timeEl = document.getElementById('__v_time');
    errorEl = document.getElementById('__v_error');
  }

  function updateUI() {
    if (!dot) return;
    dot.className = '__v_dot ' + status;
    var texts = { connected: 'Connected', compiling: 'Compiling...', error: 'Error', disconnected: 'Disconnected', loading: 'Connecting...' };
    if (statusEl) statusEl.textContent = texts[status] || status;
    if (timeEl && lastCompileMs > 0) timeEl.textContent = lastCompileMs + 'ms';
    if (errorEl) errorEl.textContent = errorMsg;
  }

  if (typeof document !== 'undefined' && document.body) {
    createMenu();
    connect();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() {
      createMenu();
      connect();
    });
  }
})();
