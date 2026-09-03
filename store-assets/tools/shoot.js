// shoot.js — drives one headless Chrome page over the DevTools protocol and
// writes the store screenshots out of it.
//
// Each scene in scenes.json is a set of saved settings: the driver seeds them
// into the page's storage, reloads so the page comes up already in that state,
// and captures the viewport. The clock is pinned to one instant across every
// scene, so the five pictures read as five views of the same moment rather
// than five unrelated times.
//
// Started by screenshots.sh, which supplies the server and browser it talks to
// through PAGE_URL, OUT_DIR, CDP_PORT, VW and VH.
const fs = require('fs');
const path = require('path');

const PORT = process.env.CDP_PORT || 9222;
const URL = process.env.PAGE_URL;
const OUT_DIR = process.env.OUT_DIR;
const VW = parseInt(process.env.VW || '1280', 10);
const VH = parseInt(process.env.VH || '800', 10);
const ONLY = process.env.ONLY || '';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'scenes.json'), 'utf8'));
const FIXED = Date.parse(config.instant);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Stand a fixed clock in front of the page's own. clock.js reads every frame
// from `new Date()` and derives nothing from elapsed time, so pinning the
// constructor is enough to park the whole face — hands, shading, moon phase,
// readouts — at one instant, with no simulator badge over the picture.
function freezeTimeScript(ms) {
  return `(function () {
    var Real = Date;
    function Frozen(...args) {
      return args.length === 0 ? new Real(${ms}) : new Real(...args);
    }
    Frozen.prototype = Real.prototype;
    Frozen.now = function () { return ${ms}; };
    Frozen.parse = Real.parse;
    Frozen.UTC = Real.UTC;
    window.Date = Frozen;
  })();`;
}

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
  await send('Page.addScriptToEvaluateOnNewDocument',
    { source: freezeTimeScript(FIXED) });

  const evaluate = async expr => {
    const r = await send('Runtime.evaluate',
      { expression: expr, returnByValue: true, awaitPromise: true });
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
    throw new Error('page never finished loading');
  };

  const navigate = async url => {
    events.length = 0;
    await send('Page.navigate', { url });
    await waitForLoad();
  };

  // One visit to the origin first, so there is a localStorage to seed.
  await navigate(URL);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const scenes = config.scenes.filter(s => !ONLY || s.out.includes(ONLY));

  for (const scene of scenes) {
    const state = Object.assign({}, config.common, scene.storage);
    await evaluate(`
      localStorage.clear();
      var state = ${JSON.stringify(state)};
      Object.keys(state).forEach(function (k) {
        localStorage.setItem(k, JSON.stringify(state[k]));
      });
      localStorage.setItem('themeFastPath', ${JSON.stringify(state.theme)});
      true;
    `);
    await navigate(URL);
    // The face waits on the bundled fonts, and the sidebar on storage; both
    // answer within a frame or two of load, but the picture has to be of the
    // settled page rather than of whichever one landed first.
    await evaluate('document.fonts.ready.then(function () { return true; })');
    await sleep(900);
    if (scene.sidebarScroll) {
      await evaluate(`document.getElementById('sidebar').scrollTop = ${scene.sidebarScroll}; true;`);
      await sleep(200);
    }

    const diag = await evaluate(`JSON.stringify({
      theme: document.documentElement.getAttribute('data-theme'),
      collapsed: document.body.classList.contains('sidebar-collapsed'),
      digital: document.getElementById('digital').textContent,
      date: document.getElementById('date-readout').textContent,
      place: document.getElementById('location-readout').textContent,
      hands: document.getElementById('extra-hands').childElementCount,
      sidebar: (function () { var s = document.getElementById('sidebar');
        return s.clientHeight + '/' + s.scrollHeight; })()
    })`);

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const out = path.join(OUT_DIR, scene.out);
    fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
    console.log(scene.out, '|', diag);
  }

  ws.close();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
