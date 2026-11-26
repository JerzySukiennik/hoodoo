// Headless Chrome harness for the full Hoodoo app: boots, runs optional setup JS, waits for the still refine, screenshots.
// node app.mjs <out.png> [query] [setupJS] [waitMs] [w] [h]
import {createRequire} from 'node:module';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const {chromium} = require('playwright-core');
const [out = '/tmp/hoodoo-app.png', query = 'scene=dawn', setup = '', wait = '2500', w = '1440', h = '900'] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({viewport: {width: +w, height: +h}, deviceScaleFactor: +(process.env.DPR || 1), locale: 'pl-PL'});
const logs = [];
page.on('console', m => { if (m.type() !== 'log' || process.env.V) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}\n${(e.stack||'').split('\n').slice(0,4).join('\n')}`));
const t0 = Date.now();
await page.goto(`${process.env.BASE || 'http://127.0.0.1:8979/'}?${query}`, {waitUntil: 'load'});
try { await page.waitForFunction(() => window.HOODOO && document.body.classList.contains('ready'), null, {timeout: 120000}); } catch (e) { logs.push('[harness] boot timeout ' + await page.evaluate(() => document.getElementById('boot-msg')?.textContent)); }
logs.push('[boot] ' + (Date.now() - t0) + ' ms');
if (setup) { try { const r = await page.evaluate(setup); if (r !== undefined) logs.push('[setup] ' + JSON.stringify(r)); } catch (e) { logs.push('[setup error] ' + e.message); } }
await page.waitForTimeout(+wait);
await page.screenshot({path: out});
console.log(logs.slice(-40).join('\n'));
await browser.close();
