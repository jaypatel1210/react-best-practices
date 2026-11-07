#!/usr/bin/env node
// Measures the resize bug in the lab store: how often the store renders when the width changes
// without crossing the 700px breakpoint, and whether the layout still flips when it does cross.
import { launchChrome } from '../skills/optimize-renders/scripts/lib/chrome.mjs';
import { evaluate, navigate, openPage, sleep } from '../skills/optimize-renders/scripts/lib/page.mjs';

const HELP = `Usage: resize-demo.mjs [--url <lab url>]
Compares Store renders on ?variant=broken and ?variant=fixed. Exits 1 if the results are wrong.
Start the lab first: (cd plugins/react-render-audit/fixtures/lab && bun run dev)
Example: node plugins/react-render-audit/tests/resize-demo.mjs --url http://localhost:5199`;

const args = process.argv.slice(2);
let url = 'http://localhost:5199';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--help' || args[i] === '-h') {
    console.log(HELP);
    process.exit(0);
  } else if (args[i] === '--url' && args[i + 1]) {
    url = args[++i];
  } else {
    console.error(`Unknown or incomplete argument: ${args[i]}. Run with --help.`);
    process.exit(2);
  }
}

const SAME_SIDE_WIDTHS = [950, 900, 850, 800, 750];
const READ = `JSON.stringify({ renders: window.__truth.Store, compact: !!document.querySelector('.promo--compact') })`;

async function measure(browser, variant) {
  const { page, close } = await openPage(browser, { width: 1000, height: 700 });
  const resize = async (width) => {
    await page.send('Emulation.setDeviceMetricsOverride', { width, height: 700, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
  };
  const read = async () => JSON.parse(await evaluate(page, READ));
  try {
    await navigate(page, `${url}/?variant=${variant}`);
    await sleep(500);
    const start = await read();
    for (const width of SAME_SIDE_WIDTHS) await resize(width);
    const sameSide = await read();
    await resize(650);
    const crossed = await read();
    return {
      variant,
      wasted: sameSide.renders - start.renders,
      onCross: crossed.renders - sameSide.renders,
      flipped: !sameSide.compact && crossed.compact,
    };
  } finally {
    await close();
  }
}

let browser;
try {
  browser = await launchChrome();
  const broken = await measure(browser, 'broken');
  const fixed = await measure(browser, 'fixed');
  for (const r of [broken, fixed]) {
    console.log(`${r.variant}: ${r.wasted} renders over ${SAME_SIDE_WIDTHS.length} resizes, ${r.onCross} on crossing 700px, layout flipped: ${r.flipped}`);
  }
  const pass = broken.wasted === SAME_SIDE_WIDTHS.length && fixed.wasted === 0 && fixed.onCross === 1 && broken.flipped && fixed.flipped;
  console.log(pass ? 'PASS: the fix removes the wasted renders and keeps the behavior' : 'FAIL: results differ from the expected values');
  process.exitCode = pass ? 0 : 1;
} catch (error) {
  console.error(`Could not run the check against ${url}: ${error.message}`);
  process.exitCode = 2;
}
await browser?.close();
process.exit(process.exitCode);
