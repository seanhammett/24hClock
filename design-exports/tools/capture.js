// capture.js — drives one headless Chrome page over the DevTools protocol:
// loads the clock at a fixed viewport with the sidebar open, then runs
// serializer.js inside it and writes back the SVG that comes out.
//
// Started by export-svg.sh, which supplies the server and browser it talks to
// through PAGE_URL, OUT_FILE, THEME, CDP_PORT, VW and VH.
const fs = require('fs');
const path = require('path');

const PORT = process.env.CDP_PORT || 9222;
const URL = process.env.PAGE_URL;
const OUT = process.env.OUT_FILE;
const THEME = process.env.THEME || 'light';
const VW = parseInt(process.env.VW || '1440', 10);
const VH = parseInt(process.env.VH || '900', 10);

const serializer = fs.readFileSync(path.join(__dirname, 'serializer.js'), 'utf8');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    } else if (msg.method) events.push(msg.method);
  };
  const send = (method, params = {}) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',
    { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expr, opts = {}) => {
    const r = await send('Runtime.evaluate',
      Object.assign({ expression: expr, returnByValue: true, awaitPromise: true }, opts));
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  };

  const waitForLoad = async () => {
    for (let i = 0; i < 100; i++) {
      if (events.includes('Page.loadEventFired')) return;
      await sleep(100);
    }
  };

  await send('Page.navigate', { url: URL });
  await waitForLoad();
  await sleep(400);

  // Seed the localStorage fallback the page uses outside the extension, then
  // reload so theme.js picks the theme up before first paint.
  await evaluate(`
    localStorage.setItem('themeFastPath', ${JSON.stringify(THEME)});
    localStorage.setItem('theme', ${JSON.stringify(JSON.stringify(THEME))});
    localStorage.setItem('sidebarCollapsed', 'false');
    true;
  `);
  events.length = 0;
  await send('Page.reload');
  await waitForLoad();
  await sleep(1200);

  await evaluate(`
    document.body.classList.remove('sidebar-collapsed');
    document.querySelectorAll('.sidebar-tab')
      .forEach(t => t.setAttribute('aria-expanded', 'true'));
    document.fonts.ready.then(() => true);
  `);
  await sleep(400);

  const diag = await evaluate(`JSON.stringify({
    theme: document.documentElement.getAttribute('data-theme'),
    collapsed: document.body.classList.contains('sidebar-collapsed'),
    sidebarScroll: (() => { const s = document.getElementById('sidebar');
      return { client: s.clientHeight, scroll: s.scrollHeight }; })(),
    fontsLoaded: document.fonts.status,
    digital: document.getElementById('digital').textContent,
    location: document.getElementById('location-readout').textContent
  })`);

  const svg = await evaluate(serializer);
  fs.writeFileSync(OUT, svg);
  console.log(OUT, '->', svg.length, 'bytes |', diag);
  ws.close();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
