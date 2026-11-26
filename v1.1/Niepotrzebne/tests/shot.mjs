// Headless Chrome (real GPU via ANGLE/Metal) screenshot harness for Hoodoo engine tests.
// node shot.mjs <url> <out.png> [width] [height] [timeoutMs]
import {createRequire} from 'node:module';
const require = createRequire('/Users/jurek/openclaw/node_modules/');
const {chromium} = require('playwright-core');
const [url, out = 'shot.png', w = '960', h = '540', tmo = '120000'] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({viewport: {width: +w, height: +h}, deviceScaleFactor: 1});
const logs = [];
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(url, {waitUntil: 'load'});
try { await page.waitForFunction(() => window.T && (T.status === 'done' || T.status === 'error'), null, {timeout: +tmo}); } catch (e) { logs.push('[harness] timeout'); }
await page.waitForTimeout(200);
const T = await page.evaluate(() => window.T);
await page.screenshot({path: out});
console.log(JSON.stringify(T), 'wall', Date.now() - t0, 'ms');
console.log(logs.slice(-30).join('\n'));
await browser.close();
