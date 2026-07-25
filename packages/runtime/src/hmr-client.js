// Vesk HMR Client — dev-only, injected into client bundle
(function() {
  var host = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/_vesk/hmr';
  var ws = null;
  var status = 'loading';
  var errorMsg = '';
  var lastCompileMs = 0;
  var reconnectTimer = null;

  // ── Surgical page update — replaces only <main> content ──
  function applyPageUpdate(name) {
    try {
      var main = document.querySelector('main');
      if (!main) {
        __router.navigate(window.location.pathname, { replace: true });
        return;
      }
      var match = __router._currentMatch;
      if (!match) return;
      var params = match.params || {};
      var pageFn = __components[name];
      if (!pageFn) {
        __router.navigate(window.location.pathname, { replace: true });
        return;
      }
      var walker = createHydrateWalker(main, []);
      var newContent = pageFn({ params: params }, new Map(), walker);
      main.innerHTML = '';
      if (newContent && newContent.nodeType) main.appendChild(newContent);
    } catch(ex) {
      // Fallback to full navigate
      __router.navigate(window.location.pathname, { replace: true });
    }
  }

  function connect() {
    try {
      ws = new WebSocket(host);
      ws.onopen = function() {
        status = 'connected';
        updateDot();
      };
      ws.onmessage = function(e) {
        try {
          var msg = JSON.parse(e.data);
          switch (msg.type) {
            case 'component-update':
              eval(msg.fnSource);
              status = 'updated';
              lastCompileMs = msg.time || 0;
              updateDot();
              if (typeof __router !== 'undefined') {
                if (typeof __router.__updateComponents === 'function') {
                  __router.__updateComponents(__router.routeTree);
                }
                if (msg.kind === 'layout') {
                  __router.navigate(window.location.pathname, { replace: true });
                } else if (msg.kind === 'page') {
                  applyPageUpdate(msg.name);
                } else {
                  __router.navigate(window.location.pathname, { replace: true });
                }
              }
              break;
            case 'full-reload':
              window.location.reload();
              break;
            case 'error':
              status = 'error';
              errorMsg = msg.message || 'Unknown error';
              updateDot();
              showToast('Compile error: ' + errorMsg);
              break;
            case 'compiling':
              status = 'compiling';
              updateDot();
              break;
          }
        } catch(ex) { /* ignore bad messages */ }
      };
      ws.onclose = function() {
        status = 'disconnected';
        updateDot();
        scheduleReconnect();
      };
      ws.onerror = function() {
        status = 'disconnected';
        updateDot();
        scheduleReconnect();
      };
    } catch(ex) { /* WebSocket unavailable */ }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  }

  // ── Floating menu ──
  var menu = null;
  var dot = null;
  var label = null;

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
      '#__vesk_dev .__v_detail{display:none;position:absolute;bottom:calc(100% + 8px);right:0;background:#1a1b26;border:1px solid #2a2b3e;border-radius:8px;padding:10px 14px;min-width:240px;box-shadow:0 4px 24px rgba(0,0,0,0.6);white-space:pre-wrap;word-break:break-all;font-size:11px;}' +
      '#__vesk_dev .__v_bar.open .__v_detail{display:block;}' +
      '#__vesk_dev .__v_detail_row{display:flex;justify-content:space-between;gap:12px;padding:2px 0;}' +
      '#__vesk_dev .__v_detail_label{color:#888;}' +
      '#__vesk_dev .__v_detail_val{color:#e0e0e0;text-align:right;}' +
      '#__vesk_dev .__v_error{color:#ef4444;font-size:11px;margin-top:4px;max-width:280px;overflow:hidden;text-overflow:ellipsis;}' +
      '@keyframes __v_pulse{0%,100%{opacity:1}50%{opacity:.4}}' +
      '</style>' +
      '<div class="__v_bar">' +
      '  <span class="__v_dot loading"></span>' +
      '  <span class="__v_label">Vesk</span>' +
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
    label = menu.querySelector('.__v_label');
  }

  function updateDot() {
    if (!dot) return;
    dot.className = '__v_dot ' + status;
    var statusEl = document.getElementById('__v_status');
    if (statusEl) {
      var texts = { connected: 'Connected', compiling: 'Compiling...', error: 'Error', disconnected: 'Disconnected', loading: 'Connecting...', updated: 'Updated' };
      statusEl.textContent = texts[status] || status;
    }
  }

  function showToast(msg) {
    var errEl = document.getElementById('__v_error');
    if (errEl) errEl.textContent = msg;
  }

  // ── Init ──
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
