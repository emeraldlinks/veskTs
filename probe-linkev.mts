import { parseHTML } from 'linkedom';
const { document, window } = parseHTML(`<!DOCTYPE html><html><body><button id="b" data-vsk-ev>x</button></body></html>`);
const b = document.getElementById('b');
b.__evh_click = () => { (window as any).fired = true; };
document.addEventListener('click', (e: Event) => {
  const t = (e.target as Element)?.closest?.('[data-vsk-ev]') as Element | null;
  if (t && (t as any).__evh_click) (t as any).__evh_click();
});
b.dispatchEvent(new window.Event('click', { bubbles: true }));
console.log('fired=', (window as any).fired === true);
console.log('bubbled path ok');
process.exit(0);
