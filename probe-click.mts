import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/data/data/com.termux/files/usr/bin/chromium-browser',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const page = await browser.newPage();
for (const route of ['/', '/comp-test']) {
  await page.goto('http://localhost:3000' + route, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
  const out = await page.evaluate(() => {
    const root = document.getElementById('root');
    const claims = [];
    const evProps = [];
    const walk = (el, path, depth) => {
      if (!el || depth > 4) return;
      if (el.__vsk_ssrEls || el.__vsk_ssrText) claims.push(path + ' ' + el.nodeName + '.' + (el.className || '').toString().slice(0, 20));
      const keys = Object.keys(el).filter((k) => k.startsWith('__ev'));
      if (keys.length) evProps.push(path + ' ' + keys.join(','));
      for (const c of el.children) walk(c, path + '/' + c.nodeName.toLowerCase(), depth + 1);
    };
    walk(root, 'root', 0);
    return { claims: claims.slice(0, 12), totalClaims: claims.length, evProps: evProps.slice(0, 8), rootKids: root.childNodes.length };
  });
  console.log(route, JSON.stringify(out));
}
await browser.close();