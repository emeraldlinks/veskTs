import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser', args: ['--no-sandbox','--disable-dev-shm-usage'], headless: 'new' });
const p = await b.newPage();
const urls = [];
p.on('response', r => { const u = r.url(); if (/\.js/.test(u)) { urls.push(u); console.log('[load]', u); } });
await p.goto('http://localhost:3000/', { waitUntil: 'networkidle0', timeout: 20000 });
await new Promise(r => setTimeout(r, 800));
console.log('TOTAL', urls.length);
await b.close();
