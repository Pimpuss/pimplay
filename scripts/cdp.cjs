// Petit client CDP pour inspecter l'app Electron lancée avec --remote-debugging-port=9333.
// Usage : node scripts/cdp.cjs eval "<expression>" | node scripts/cdp.cjs shot <fichier.png>
const fs = require('node:fs');

(async () => {
  const [cmd, arg] = process.argv.slice(2);
  const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const call = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === myId) { ws.removeEventListener('message', onMsg); resolve(m.result); }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  if (cmd === 'shot') {
    const r = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(arg, Buffer.from(r.data, 'base64'));
    console.log('saved', arg);
  } else {
    const r = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
    console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails ?? r, null, 2));
  }
  ws.close();
})();
