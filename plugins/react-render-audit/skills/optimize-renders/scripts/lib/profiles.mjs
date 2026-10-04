// Device profiles for the timing benchmark, matching Lighthouse's: "mobile" is a mid-tier phone
// (412×823 at 1.75× density, phone user agent, CPU slowed to phone speed) and "desktop" is a
// 1350×940 screen at full speed. The mobile CPU slowdown is calibrated on each machine, so a fast
// laptop and a slow one both emulate the same phone.
import { evaluate } from './page.mjs';

export const PROFILE_NAMES = ['mobile', 'desktop'];

/**
 * Lighthouse's default 4× slowdown moves a typical high-end desktop (BenchmarkIndex 1500–2000)
 * into the mid-tier mobile range (125–800). The midpoint, 1750 / 4, is the speed the mobile
 * profile aims for on every machine.
 */
export const MOBILE_TARGET_INDEX = 1750 / 4;
export const DEFAULT_MOBILE_RATE = 4;

export function profile(name, { chromeMajor = '140' } = {}) {
  if (name === 'mobile') {
    return {
      name: 'mobile',
      width: 412,
      height: 823,
      deviceScaleFactor: 1.75,
      mobile: true,
      userAgent: `Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Mobile Safari/537.36`,
      userAgentMetadata: {
        brands: [
          { brand: 'Chromium', version: String(chromeMajor) },
          { brand: 'Google Chrome', version: String(chromeMajor) },
          { brand: 'Not.A/Brand', version: '99' },
        ],
        platform: 'Android',
        platformVersion: '11.0.0',
        architecture: '',
        model: 'moto g power (2022)',
        mobile: true,
      },
    };
  }
  if (name === 'desktop') return { name: 'desktop', width: 1350, height: 940, deviceScaleFactor: 1, mobile: false };
  throw new Error(`Unknown profile "${name}" (use ${PROFILE_NAMES.join(' or ')})`);
}

/** "HeadlessChrome/141.0.7390.54" -> "141" */
export function chromeMajor(product) {
  const match = /\/(\d+)\./.exec(String(product || ''));
  return match ? match[1] : null;
}

/**
 * The same measurement as Lighthouse's BenchmarkIndex, so the result can be read against its
 * device-class table: the average of how many times per second (divided by 10) the page can build
 * a 10,000-character string, and copy a 100,000-element array.
 */
export const BENCHMARK_EXPRESSION = `(() => {
  const stringRate = () => {
    const started = Date.now();
    let rounds = 0;
    while (Date.now() - started < 500) {
      let text = '';
      for (let i = 0; i < 10000; i++) text += 'a';
      if (text.length === 1) throw new Error('unreachable');
      rounds++;
    }
    return Math.round(rounds / 10 / ((Date.now() - started) / 1000));
  };
  const copyRate = () => {
    const first = [];
    const second = [];
    for (let i = 0; i < 100000; i++) first[i] = second[i] = i;
    const started = Date.now();
    let rounds = 0;
    // Checking the clock only every 10th round avoids a known CPU performance cliff.
    while (rounds % 10 !== 0 || Date.now() - started < 500) {
      const from = rounds % 2 === 0 ? first : second;
      const to = rounds % 2 === 0 ? second : first;
      for (let i = 0; i < from.length; i++) to[i] = from[i];
      rounds++;
    }
    return Math.round(rounds / 10 / ((Date.now() - started) / 1000));
  };
  return (stringRate() + copyRate()) / 2;
})()`;

/** The slowdown that brings a machine with `hostIndex` to the target, within [1, 20]. */
export function rateFor(hostIndex, target = MOBILE_TARGET_INDEX) {
  if (!hostIndex || hostIndex <= 0) return DEFAULT_MOBILE_RATE;
  return Math.round(Math.min(20, Math.max(1, hostIndex / target)) * 10) / 10;
}

async function benchmarkIndex(browser, rate = 1) {
  const { conn } = browser;
  const { browserContextId } = await conn.send('Target.createBrowserContext', { disposeOnDetach: true });
  const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
  const page = conn.session(sessionId);
  try {
    await page.send('Runtime.enable');
    if (rate > 1) await page.send('Emulation.setCPUThrottlingRate', { rate });
    return await evaluate(page, BENCHMARK_EXPRESSION);
  } finally {
    await conn.send('Target.closeTarget', { targetId }).catch(() => {});
    await conn.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

const medianOf = (values) => values.slice().sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Measures this machine (median of three), picks the slowdown that brings it to the target, then
 * measures again under that slowdown to check it, correcting once if it's more than 10% off.
 * Returns { hostIndex, rate, throttledIndex, target }.
 */
export async function calibrate(browser, { target = MOBILE_TARGET_INDEX, log = () => {} } = {}) {
  const host = [];
  for (let i = 0; i < 3; i++) host.push(await benchmarkIndex(browser));
  const hostIndex = medianOf(host);
  let rate = rateFor(hostIndex, target);
  let throttledIndex = await benchmarkIndex(browser, rate);
  if (throttledIndex && Math.abs(throttledIndex - target) / target > 0.1 && rate > 1 && rate < 20) {
    rate = Math.round(Math.min(20, Math.max(1, (rate * throttledIndex) / target)) * 10) / 10;
    throttledIndex = await benchmarkIndex(browser, rate);
  }
  log(`CPU calibration: this machine scores ${Math.round(hostIndex)} (BenchmarkIndex); ${rate}× slowdown brings it to ${Math.round(throttledIndex)} (target ${Math.round(target)}, a mid-tier phone)`);
  return { hostIndex: Math.round(hostIndex), rate, throttledIndex: Math.round(throttledIndex), target: Math.round(target) };
}
