(function() {
  var host = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/_vesk/hmr';
  var ws = null;
  var status = 'loading';
  var lastError = null;
  var lastCompileMs = 0;
  var reconnectTimer = null;

  function connect() {
    try {
      ws = new WebSocket(host);
      ws.onopen = function() {
        status = 'connected';
        clearError();
        updateDot();
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
              status = 'connected';
              clearError();
              updateDot();
              break;
            case 'reload':
              window.location.reload();
              break;
            case 'error':
              status = 'error';
              lastError = msg;
              showOverlay(msg);
              updateDot();
              break;
            case 'css-update':
              document.querySelectorAll('link[rel="stylesheet"]').forEach(function(el) {
                var parent = el.parentNode;
                if (!parent) return;
                var fresh = document.createElement('link');
                fresh.rel = 'stylesheet';
                fresh.href = el.href.split('?')[0] + '?t=' + Date.now();
                fresh.onload = function() { el.remove(); };
                fresh.onerror = function() { fresh.remove(); };
                parent.insertBefore(fresh, el.nextSibling);
              });
              status = 'connected';
              updateDot();
              break;
            case 'compiling':
              status = 'compiling';
              clearError();
              updateDot();
              break;
          }
        } catch(ex) { /* ignore bad messages */ }
      };
      ws.onclose = function() { if (status !== 'error') { status = 'disconnected'; updateDot(); } scheduleReconnect(); };
      ws.onerror = function() { if (status !== 'error') { status = 'disconnected'; updateDot(); } scheduleReconnect(); };
    } catch(ex) { /* WebSocket unavailable */ }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  }

  function clearError() {
    lastError = null;
    hideOverlay();
  }

  var overlayEl = null;
  var overlayVisible = false;

  function createOverlay() {
    if (document.getElementById('__vesk_overlay')) return;
    overlayEl = document.createElement('div');
    overlayEl.id = '__vesk_overlay';
    overlayEl.innerHTML =
      '<style>' +
      '#__vesk_overlay{all:initial;position:fixed;inset:0;z-index:2147483646;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.5;color:#e0e0e0;display:none;}' +
      '#__vesk_overlay.open{display:flex;}' +
      '#__vesk_overlay .__vo_backdrop{position:absolute;inset:0;background:rgba(0,0,0,0.65);backdrop-filter:blur(2px);}' +
      '#__vesk_overlay .__vo_panel{position:relative;margin:32px auto;max-width:800px;width:90%;max-height:calc(100vh - 64px);background:#1a1b26;border:1px solid #2a2b3e;border-radius:12px;box-shadow:0 8px 48px rgba(0,0,0,0.7);display:flex;flex-direction:column;overflow:hidden;}' +
      '#__vesk_overlay .__vo_header{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid #2a2b3e;flex-shrink:0;}' +
      '#__vesk_overlay .__vo_icon{width:20px;height:20px;border-radius:50%;background:#ef4444;flex-shrink:0;}' +
      '#__vesk_overlay .__vo_title{font-size:14px;font-weight:700;color:#ef4444;flex:1;}' +
      '#__vesk_overlay .__vo_close{all:unset;cursor:pointer;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:4px;color:#888;font-size:18px;}' +
      '#__vesk_overlay .__vo_close:hover{background:#2a2b3e;color:#e0e0e0;}' +
      '#__vesk_overlay .__vo_body{overflow-y:auto;padding:16px 20px;flex:1;}' +
      '#__vesk_overlay .__vo_file{font-size:12px;color:#888;margin-bottom:8px;}' +
      '#__vesk_overlay .__vo_file strong{color:#e0e0e0;}' +
      '#__vesk_overlay .__vo_message{font-size:13px;color:#f87171;padding:8px 12px;background:#2a1b1b;border-radius:6px;margin-bottom:12px;white-space:pre-wrap;word-break:break-all;}' +
      '#__vesk_overlay .__vo_code{background:#0f0f1a;border-radius:6px;padding:12px;margin-bottom:12px;overflow-x:auto;font-size:12px;line-height:1.6;}' +
      '#__vesk_overlay .__vo_code pre{margin:0;white-space:pre;}' +
      '#__vesk_overlay .__vo_code .hl{background:rgba(239,68,68,0.25);display:block;}' +
      '#__vesk_overlay .__vo_code .hl::before{content:"> ";color:#ef4444;font-weight:700;}' +
      '#__vesk_overlay .__vo_code .ln{color:#555;margin-right:12px;user-select:none;}' +
      '#__vesk_overlay .__vo_tips{margin-top:8px;}' +
      '#__vesk_overlay .__vo_tips_title{font-size:11px;font-weight:700;color:#eab308;margin-bottom:4px;}' +
      '#__vesk_overlay .__vo_tip{padding:4px 0 4px 16px;font-size:12px;color:#bbb;position:relative;}' +
      '#__vesk_overlay .__vo_tip::before{content:"\\2192";position:absolute;left:0;color:#eab308;}' +
      '#__vesk_overlay .__vo_stack{margin-top:12px;}' +
      '#__vesk_overlay .__vo_stack summary{cursor:pointer;font-size:11px;color:#888;padding:4px 0;}' +
      '#__vesk_overlay .__vo_stack pre{background:#0f0f1a;border-radius:4px;padding:8px;margin-top:4px;font-size:11px;color:#888;max-height:200px;overflow:auto;white-space:pre;}' +
      '#__vesk_overlay .__vo_footer{padding:8px 20px;border-top:1px solid #2a2b3e;font-size:11px;color:#555;text-align:center;flex-shrink:0;}' +
      '</style>' +
      '<div class="__vo_backdrop"></div>' +
      '<div class="__vo_panel">' +
      '  <div class="__vo_header">' +
      '    <div class="__vo_icon"></div>' +
      '    <div class="__vo_title">Compilation Error</div>' +
      '    <button class="__vo_close" id="__vo_close">&times;</button>' +
      '  </div>' +
      '  <div class="__vo_body">' +
      '    <div class="__vo_file" id="__vo_file"></div>' +
      '    <div class="__vo_message" id="__vo_message"></div>' +
      '    <div class="__vo_code" id="__vo_code"></div>' +
      '    <div class="__vo_tips" id="__vo_tips"></div>' +
      '    <details class="__vo_stack">' +
      '      <summary>Stack trace</summary>' +
      '      <pre id="__vo_stack"></pre>' +
      '    </details>' +
      '  </div>' +
      '  <div class="__vo_footer">Vesk dev — click background or X to dismiss</div>' +
      '</div>';
    document.body.appendChild(overlayEl);

    document.getElementById('__vo_close').onclick = hideOverlay;
    overlayEl.querySelector('.__vo_backdrop').onclick = hideOverlay;
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && overlayVisible) hideOverlay(); });
  }

  function showOverlay(msg) {
    if (!overlayEl) createOverlay();
    overlayVisible = true;
    overlayEl.classList.add('open');

    var fileInfo = '';
    if (msg.file) {
      fileInfo = 'File: <strong>' + escapeHtml(msg.file) + '</strong>';
      if (msg.line) fileInfo += ' at line ' + msg.line + (msg.column ? ', column ' + msg.column : '');
    }
    document.getElementById('__vo_file').innerHTML = fileInfo;
    document.getElementById('__vo_message').textContent = msg.message || 'Unknown error';

    var codeHtml = '';
    if (msg.code) {
      var codeLines = msg.code.split('\n');
      codeHtml = '<pre>';
      for (var i = 0; i < codeLines.length; i++) {
        var ln = codeLines[i].match(/^(\d+):\s*/);
        var lineNum = ln ? ln[1] : '';
        var lineContent = ln ? codeLines[i].slice(ln[0].length) : codeLines[i];
        var isErrorLine = msg.line && parseInt(lineNum) === msg.line;
        codeHtml += '<span class="' + (isErrorLine ? 'hl' : '') + '"><span class="ln">' + padNum(lineNum, 4) + '</span>' + escapeHtml(lineContent) + '</span>';
      }
      codeHtml += '</pre>';
    }
    document.getElementById('__vo_code').innerHTML = codeHtml;

    var tipsHtml = '';
    if (msg.tips && msg.tips.length > 0) {
      tipsHtml = '<div class="__vo_tips_title">Debug Tips</div>';
      for (var t = 0; t < msg.tips.length; t++) {
        tipsHtml += '<div class="__vo_tip">' + msg.tips[t] + '</div>';
      }
    }
    document.getElementById('__vo_tips').innerHTML = tipsHtml;
    document.getElementById('__vo_stack').textContent = msg.stack || '(no stack trace)';
  }

  function hideOverlay() {
    overlayVisible = false;
    if (overlayEl) overlayEl.classList.remove('open');
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function padNum(n, len) {
    n = String(n);
    while (n.length < len) n = ' ' + n;
    return n;
  }

  var dot = null;

  function createDot() {
    if (document.getElementById('__vesk_dev')) return;
    dot = document.createElement('div');
    dot.id = '__vesk_dev';
    dot.innerHTML =
      '<style>' +
      '#__vesk_dev{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;font-family:ui-monospace,monospace;font-size:11px;line-height:1.4;color:#e0e0e0;}' +
      '#__vesk_dev .__v_bar{display:flex;align-items:center;gap:8px;background:#1a1b26;border:1px solid #2a2b3e;border-radius:10px;padding:6px 12px;box-shadow:0 4px 24px rgba(0,0,0,0.6);transition:all .2s;}' +
      '#__vesk_dev .__v_bar:hover{border-color:#3a3b5e;}' +
      '#__vesk_dev .__v_dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;transition:background .3s;}' +
      '#__vesk_dev .__v_dot.connected{background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,0.5);}' +
      '#__vesk_dev .__v_dot.compiling{background:#eab308;box-shadow:0 0 6px rgba(234,179,8,0.5);animation:__v_pulse .8s infinite;}' +
      '#__vesk_dev .__v_dot.error{background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,0.5);}' +
      '#__vesk_dev .__v_dot.disconnected{background:#6b7280;}' +
      '#__vesk_dev .__v_dot.loading{background:#6b7280;animation:__v_pulse 1.2s infinite;}' +
      '#__vesk_dev .__v_label{white-space:nowrap;}' +
      '#__vesk_dev .__v_version{font-size:9px;color:#555;}' +
      '@keyframes __v_pulse{0%,100%{opacity:1}50%{opacity:.4}}' +
      '</style>' +
      '<div class="__v_bar">' +
      '  <span class="__v_dot loading"></span>' +
      '  <span class="__v_label">Vesk</span>' +
      '  <span class="__v_version">dev</span>' +
      '</div>';
    document.body.appendChild(dot);
  }

  function updateDot() {
    if (!document.getElementById('__vesk_dev')) createDot();
    var d = document.querySelector('#__vesk_dev .__v_dot');
    if (d) d.className = '__v_dot ' + status;
  }

  if (typeof document !== 'undefined' && document.body) {
    createDot();
    connect();
  } else if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function() { createDot(); connect(); });
  }
})();