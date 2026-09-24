import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
let orig = fs.readFileSync('/tmp/opencode/rt3.js', 'utf8');
const mk = `const __gt=(s)=>{try{return s&&s.nodeType===8?("<!--"+String(s.nodeValue)+"-->"):((s.textContent||"").trim().slice(0,4));}catch(e){return String(s);}};`;
orig = mk + orig;
orig = orig.replace('function reconcile(anchor, endAnchor, items, keyFn, createItem, claim) {', 'function reconcile(anchor, endAnchor, items, keyFn, createItem, claim) { console.error("[RC] inp="+JSON.stringify(items)+" parent="+(anchor.parentNode&&anchor.parentNode.getAttribute?anchor.parentNode.getAttribute("id"):""));');
orig = orig.replace('return (newItems) => {', 'return (newItems) => { console.error("[INIT-UPD] new="+JSON.stringify(newItems));');
orig = orig.replace('function moveBefore(marker, endAnchor, ref) {', 'function moveBefore(marker, endAnchor, ref) { const __list=()=>{const a=[];let n=marker.parentNode&&marker.parentNode.firstChild;for(let i=0;n&&i<30;i++){a.push(__gt(n));n=n.nextSibling;}return a.join(",");}; console.error("[MB] "+__gt(marker)+"->"+__gt(ref)+" before: "+__list());');
const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.setRequestInterception(true);
page.on('request', (req) => {
  if (req.url().endsWith('/_vesk/runtime.js')) req.respond({ status: 200, contentType: 'application/javascript', body: orig });
  else req.continue();
});
const logs = [];
page.on('console', (m) => { logs.push(String(m.text())); });
await page.goto('http://localhost:3000/map', { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise((r) => setTimeout(r, 700));
await page.evaluate(() => Array.from(document.querySelectorAll('button'))[0].click());
await new Promise((r) => setTimeout(r, 500));
const dom = await page.evaluate(() => Array.from(document.getElementById('rk-list').childNodes).map(n => n.nodeType===8?("<!--"+n.nodeValue+"-->"):(n.textContent||"").trim()));
console.log('FINAL', JSON.stringify(dom));
console.log('LOGS:');
for (const l of logs.slice(0, 40)) console.log(' ', l.slice(0, 300));
console.log('ERRS:', JSON.stringify(errs.slice(0,6)));
await browser.close();
