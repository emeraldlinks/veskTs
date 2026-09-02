import puppeteer from 'puppeteer-core';

const CHROMIUM_PATH = process.env.CHROMIUM_PATH || '/data/data/com.termux/files/usr/bin/chromium-browser';
const BASE = process.env.BASE_URL || 'http://localhost:3055';
const PROVIDER = process.env.AGENTIC_PROVIDER || 'opencode';
const MODEL = process.env.AGENTIC_MODEL || 'nemotron-3.5-lightning-free';
const PROMPT = process.env.AGENTIC_PROMPT || 'say Ok';
const MAX_ATTEMPTS = parseInt(process.env.MAX_ATTEMPTS || '20', 10);
const SETTLE_MS = parseInt(process.env.SETTLE_MS || '5000', 10);
const REPLY_TIMEOUT_MS = parseInt(process.env.REPLY_TIMEOUT_MS || '30000', 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function retryEval(page, fn, attempts, label = 'fn', ...args) {
  const main = page.mainFrame();
  for (let i = 0; i < attempts; i++) {
    try {
      return await main.evaluate(fn, ...args);
    } catch (e) {
      const m = String((e && e.message) || e);
      if (/Execution context was destroyed|detached|Session closed|frame was detached|Cannot find context|frame was detached from the page/i.test(m)) {
        await sleep(1500);
        continue;
      }
      throw e;
    }
  }
  throw new Error('retryEval exhausted for ' + label);
}

// Poll until fn returns truthy (or throws non-detach). Returns the value, or times out.
async function waitFor(page, fn, timeoutMs, label = 'waitFor', ...args) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await retryEval(page, fn, MAX_ATTEMPTS, label, ...args);
    if (v) return v;
    await sleep(1200);
  }
  return null;
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err && err.message).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console: ' + String(m.text()).slice(0, 300));
  });
  await page.setViewport({ width: 1280, height: 900 });

  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (e) {
    console.log('goto err (ignored):', String(e).slice(0, 80));
  }
  console.log('goto done; settling for HMR ' + SETTLE_MS + 'ms');
  await sleep(SETTLE_MS);

  // 1) Ensure panel open (toggle via __v_bar, force unhide)
  await waitFor(
    page,
    () => {
      const root = document.querySelector('#__vesk_dev');
      if (!root) return false;
      const bar = root.querySelector('.__v_bar');
      const kp = root.querySelector('.__kp');
      if (kp && kp.classList.contains('hidden')) {
        if (bar) bar.click();
      } else if (!kp) {
        if (bar) bar.click();
      }
      const kk = root.querySelector('.__kp');
      if (kk && !kk.classList.contains('hidden') && root.querySelector('#__kp_content')) return true;
      return false;
    },
    20000,
    'open panel'
  );
  console.log('panel open');
  await sleep(1500);

  // 2) Settings tab -> Agentic subtab
  const settingsOk = await waitFor(
    page,
    () => {
      const root = document.querySelector('#__vesk_dev');
      if (!root) return false;
      const settingsBtn = Array.from(root.querySelectorAll('[data-tab="settings"]'))[0];
      if (settingsBtn) settingsBtn.click();
      return true;
    },
    10000,
    'settings tab'
  );
  console.log('settings tab clicked:', !!settingsOk);
  const subOk = await waitFor(
    page,
    () => {
      const root = document.querySelector('#__vesk_dev');
      if (!root) return false;
      if (!root.querySelector('[data-settings-pane="agentic"]')) {
        const sub = Array.from(root.querySelectorAll('[data-settings-subtab="agentic"], [data-settings-tab="agentic"]'))[0];
        if (sub) {
          sub.click();
          return false;
        }
        return false;
      }
      return true;
    },
    15000,
    'agentic subtab'
  );
  console.log('agentic subtab engaged:', !!subOk);
  await sleep(1500);

  // 3) Pick provider (div buttons). Works in Settings->Agentic and the Agentic chat tab alike.
  const provPicked = await waitFor(
    page,
    (providerName) => {
      const root = document.querySelector('#__vesk_dev');
      if (!root) return false;
      const btn =
        root.querySelector('[data-agentic-provider="' + providerName + '"]') ||
        root.querySelector('[data-val="' + providerName + '"][data-key="agenticProvider"]');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    15000,
    'pick provider',
    PROVIDER
  );
  console.log('provider picked (' + PROVIDER + '):', !!provPicked);
  await sleep(3000);

  // 4) Wait for the model to appear & select it
  const modelPicked = await waitFor(
    page,
    (modelName, providerName) => {
      const root = document.querySelector('#__vesk_dev');
      if (!root) return false;
      const btn = root.querySelector('[data-agentic-model="' + modelName + '"]');
      if (btn) {
        btn.click();
        return true;
      }
      // also accept data-val fallback (data-key="agenticModel")
      const alt = root.querySelector('[data-val="' + modelName + '"][data-key="agenticModel"]');
      if (alt) {
        alt.click();
        return true;
      }
      return false;
    },
    20000,
    'pick model',
    MODEL,
    PROVIDER
  );
  console.log('model picked (' + MODEL + '):', !!modelPicked);

  // If the target model never rendered, list what IS rendered for diagnosis.
  if (!modelPicked) {
    const list = await retryEval(
      page,
      () => Array.from(document.querySelectorAll('#__vesk_dev [data-agentic-model]')).map((el) => el.getAttribute('data-agentic-model')),
      MAX_ATTEMPTS,
      'model list dump'
    );
    console.log('rendered model list:', JSON.stringify(list));
  }
  await sleep(2000);

  // 5) Agentic CHAT tab (owns the input + send button)
  await waitFor(
    page,
    () => {
      const btn = Array.from(document.querySelectorAll('#__vesk_dev [data-tab="agentic"]'))[0];
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    10000,
    'agentic chat tab'
  );
  console.log('agentic chat tab engaged');
  await sleep(1500);

  // 5b) Mobile-typing stability: the textbox must survive keystrokes IN PLACE
  // (no panel re-render) or the on-screen keyboard dismisses every keystroke.
  const typingRes = await (async () => {
    const focused = await waitFor(
      page,
      () => {
        const input = document.querySelector('#__vesk_dev [data-agentic-input]');
        if (!input) return false;
        input.focus();
        return document.activeElement === input;
      },
      10000,
      'focus input'
    );
    if (!focused) return { ok: false, why: 'no input to focus' };
    await retryEval(
      page,
      () => {
        const el = document.querySelector('#__vesk_dev [data-agentic-input]');
        if (!el) return false;
        window.__probeInput = el;
        el.setAttribute('data-probe-mark', 'typing1');
        return true;
      },
      MAX_ATTEMPTS,
      'mark input node'
    );
    await page.keyboard.type('/help hmm ', { delay: 35 });
    await sleep(400);
    return await retryEval(
      page,
      () => {
        const el = document.querySelector('#__vesk_dev [data-agentic-input]');
        const same = !!el && window.__probeInput === el;
        const wrap = el ? el.closest('.__kp_ag_input_wrap') : null;
        const pos = wrap ? getComputedStyle(wrap).position : null;
        return {
          ok: same && !!el && el.isConnected && document.activeElement === el && el.getAttribute('data-probe-mark') === 'typing1' && pos === 'sticky',
          same,
          focused: !!el && document.activeElement === el,
          connected: !!el && el.isConnected,
          mark: el ? el.getAttribute('data-probe-mark') : null,
          value: el ? el.value : null,
          popupShown: !!document.querySelector('#__vesk_dev [data-agentic-popup]'),
          wrapPosition: pos,
        };
      },
      MAX_ATTEMPTS,
      'typing stability'
    );
  })();
  console.log('mobile typing stable:', JSON.stringify(typingRes));

  // 6) Type + send
  const sent = await waitFor(
    page,
    (prompt) => {
      const input = document.querySelector('#__vesk_dev [data-agentic-input]');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, prompt);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      const sendBtn = document.querySelector('#__vesk_dev [data-agentic-send]');
      if (!sendBtn) return false;
      sendBtn.click();
      return true;
    },
    10000,
    'send message',
    PROMPT
  );
  console.log('message sent:', !!sent, JSON.stringify(PROMPT));

  // 6b) Mark the live messages host so "no jumping" can be proven — if the
  //     pane were re-created on send/progress, the marker would vanish.
  const marked = await waitFor(
    page,
    () => {
      const host = document.querySelector('#__vesk_dev .__kp_ag_messages, #__vesk_dev [data-agentic="messages"]');
      if (!host) return false;
      host.setAttribute('data-probe', 'stable-1');
      return true;
    },
    10000,
    'mark messages host'
  );
  console.log('messages host marked (no-jump sentinel):', !!marked);

  // 7) Poll for an assistant reply
  let reply = '';
  let failed = false;
  let lastErr = null;
  let lastAll = [];
  let sawRunningLabel = false;
  let sawMidRunText = false;
  const pollStart = Date.now();
  while (Date.now() - pollStart < REPLY_TIMEOUT_MS) {
    await sleep(2000);
    const st = await retryEval(page, () => {
      const msgs = Array.from(document.querySelectorAll('.__kp_ag_messages .__kp_ag_msg, [data-agentic-messages] .__kp_ag_msg'));
      const all = msgs.map((el) => ({
        role: (el.getAttribute && el.getAttribute('data-role')) || '',
        txt: (el.textContent || '').trim(),
      }));
      const errEl = document.querySelector('#__vesk_dev .__kp_pl_err');
      const sendBtn = document.querySelector('#__vesk_dev [data-agentic-send]');
      const running = sendBtn ? (sendBtn.textContent || '').includes('run') : false;
      const host = document.querySelector('#__vesk_dev .__kp_ag_messages, #__vesk_dev [data-agentic="messages"]');
      return {
        all,
        err: errEl ? errEl.textContent : null,
        running,
        runningLabel: sendBtn ? (sendBtn.textContent || '').trim() : '',
        marker: host ? host.getAttribute('data-probe') || '' : '',
      };
    }, MAX_ATTEMPTS, 'poll reply');
    if (st.running) sawRunningLabel = true;
    if (st.running && st.all.some((m) => /assistant|system/i.test(m.role) && m.txt)) sawMidRunText = true;
    lastErr = st.err;
    lastAll = st.all;
    const assis = st.all.filter((m) => /assistant|system/i.test(m.role) && m.txt);
    if (assis.length) {
      reply = assis[assis.length - 1].txt;
      failed = /failed/i.test(reply) || /failed/i.test(st.err || '');
      if (reply || failed) break;
    }
  }

  // final DOM snapshot for diagnosis
  const dump = await retryEval(page, () => {
    const root = document.querySelector('#__vesk_dev');
    if (!root) return { err: 'no root' };
    const content = root.querySelector('#__kp_content');
    const pane = root.querySelector('.__kp_pane');
    const el = pane || content;
    const host = root.querySelector('.__kp_ag_messages, [data-agentic="messages"]');
    return {
      rootHtmlLen: root.innerHTML.length,
      activeTab: (root.querySelector('[data-tab].active') || { getAttribute: () => '' }).getAttribute('data-tab') || '',
      contentLen: el ? el.innerHTML.length : -1,
      paneText: el ? el.textContent.slice(0, 300) : '',
      messagesHostStable: host ? host.getAttribute('data-probe') || '' : 'missing',
    };
  }, MAX_ATTEMPTS, 'final dump').catch((e) => ({ err: String(e) }));

  console.log('=== FINAL ===');
  console.log('current err line:', JSON.stringify(lastErr));
  console.log('messages:', JSON.stringify(lastAll.slice(-6)));
  console.log('panel snapshot:', JSON.stringify(dump));
  console.log('streaming evidence: runningLabelSeen=' + JSON.stringify(sawRunningLabel) + ' midRunTextSeen=' + JSON.stringify(sawMidRunText));
  console.log('pending page errors:', JSON.stringify(errors));
  if (failed) {
    console.log('RESULT: FAILED (assistant flagged as failed or error surfaced)');
    process.exitCode = 2;
  } else if (reply) {
    const stable = dump.messagesHostStable === 'stable-1';
    console.log('no-jump check:', stable ? 'PASS (messages host never recreated)' : 'FAIL (messages host was recreated)');
    if (!stable) {
      console.log('RESULT: FAILED — UI jumped (messages host re-created during the run)');
      process.exitCode = 2;
    } else {
      console.log('RESULT: PASS — assistant reply =', JSON.stringify(reply));
    }
  } else {
    console.log('RESULT: UNKNOWN — no assistant reply captured; page errors:', JSON.stringify(errors));
    process.exitCode = 3;
  }
  await browser.close();
}

main().catch((e) => {
  console.error('PROBE ERROR:', e);
  process.exit(1);
});