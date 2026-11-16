/*
 * npm run selftest  (from the repo root — it reads index.html by relative path)
 *
 * Pulls the live snow block straight out of index.html and runs it against a stub
 * canvas, so it tests the code that actually ships rather than a copy. It exists
 * because this effect broke three times in a row without anything looking wrong in
 * the source: the bitmap was sized to the page instead of the viewport (flakes
 * squashed into near-invisible, barely-moving lines), and prefers-reduced-motion
 * silently replaced the snow with a frozen field of dots and then with nothing.
 * None of that throws — it just quietly stops snowing, which no syntax check catches.
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('(function snow(){');
const end = html.indexOf('})();', start) + 5;
assert.ok(start > 0 && end > start, 'could not find the snow block in index.html');
const src = html.slice(start, end);

function run({ reduceMotion, frames }) {
  const drawn = [];
  let hidden = false;
  const ctx = {
    setTransform() {}, clearRect() {}, beginPath() {}, fill() {},
    arc(x, y, r) { drawn.push({ x, y, r }); },
    set fillStyle(v) {}, set globalAlpha(v) {},
  };
  const canvas = { width: 0, height: 0, style: { set display(v) { hidden = v === 'none'; } }, getContext: () => ctx };
  let queue = [];
  const sandbox = {
    $: () => canvas,
    window: {
      innerWidth: 1440, innerHeight: 850, devicePixelRatio: 2,
      matchMedia: () => ({ matches: reduceMotion }),
      addEventListener() {},
    },
    requestAnimationFrame: (fn) => queue.push(fn),
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  for (let i = 0; i < frames; i++) {
    const next = queue;
    queue = [];
    next.forEach((fn) => fn());
  }
  return { drawn, hidden, canvas };
}

// 1. Normal: flakes must fall. Compare each flake's y on frame 1 vs frame 60 (~1 second).
const a = run({ reduceMotion: false, frames: 61 });
const flakeCount = 110;
assert.ok(a.drawn.length >= flakeCount * 60, `expected ~60 frames of drawing, got ${a.drawn.length}`);
const firstFrame = a.drawn.slice(0, flakeCount);
const lastFrame = a.drawn.slice(60 * flakeCount, 61 * flakeCount);
const moved = lastFrame.map((f, i) => f.y - firstFrame[i].y).filter((d) => d > 0); // ignore flakes that wrapped
const minFall = Math.min(...moved);
const maxFall = Math.max(...moved);
assert.ok(moved.length > flakeCount * 0.8, 'most flakes should fall without wrapping in 1s');
assert.ok(minFall > 25, `slowest flake only fell ${minFall}px/s — too slow to read as falling`);
console.log(`falls ${minFall.toFixed(0)}–${maxFall.toFixed(0)} px per second (viewport 850px => crosses in ${(850 / maxFall).toFixed(0)}–${(850 / minFall).toFixed(0)}s)`);

// 2. Bitmap must match the viewport box times DPR, not the page height — the original bug.
assert.equal(a.canvas.width, 2880);
assert.equal(a.canvas.height, 1700);
const offscreen = a.drawn.filter((f) => f.y > 850 + 5).length;
assert.equal(offscreen, 0, 'flakes drawn below the viewport mean the bitmap is taller than its box again');
console.log('bitmap 2880x1700 for a 1440x850 viewport at dpr 2: no squashing');

// 3. prefers-reduced-motion must make NO difference: the owner asked for snow for
//    everyone, and Windows reports that preference whenever "Animation effects" is off.
//    This guards against the condition creeping back in.
const b = run({ reduceMotion: true, frames: 61 });
assert.equal(b.hidden, false, 'the snow overlay must never be hidden');
assert.equal(b.drawn.length, a.drawn.length, 'reduced motion must draw the same number of flakes');
const bMoved = b.drawn.slice(60 * flakeCount, 61 * flakeCount)
  .map((f, i) => f.y - b.drawn[i].y).filter((d) => d > 0);
const mean = (xs) => xs.reduce((x, y) => x + y, 0) / xs.length;
assert.ok(Math.abs(mean(bMoved) - mean(moved)) < 5, 'reduced motion must fall at the same speed');
console.log(`prefers-reduced-motion ignored: same ${flakeCount} flakes, same ${mean(bMoved).toFixed(0)} px/s average`);

// 4. The decorative snow caps sitting on buttons and cards.
//    They are placed with bottom:100%, which only lands correctly if the path's flat
//    underside IS the bottom of the viewBox. When it was not, the caps sank into the
//    button by however much empty space the viewBox had below the path.
const caps = html.match(/<svg[^>]*>[\s\S]*?<\/svg>/g).filter((s) => s.includes('#F3F6FA'));
assert.equal(caps.length, 4, `expected 3 snow caps, found ${caps.length}`);
for (const cap of caps) {
  const label = (cap.match(/viewBox="([^"]+)"/) || [])[1];
  const boxHeight = Number(label.trim().split(/\s+/)[3]);
  const d = cap.match(/ d="([^"]+)"/)[1];
  // Every coordinate in these paths is an x,y pair (M/L/Q/T only — no H/V), so the odd
  // indices are the y values, and a Bézier never passes below its control points.
  const nums = d.match(/-?\d*\.?\d+/g).map(Number);
  const lowest = Math.max(...nums.filter((_, i) => i % 2 === 1));
  assert.equal(lowest, boxHeight, `snow cap viewBox="${label}" has its path bottom at y=${lowest}, leaving ${boxHeight - lowest}px of dead space that drops it into whatever it sits on`);
  assert.ok(/bottom:\s*calc\(100% - 1px\)/.test(cap), `snow cap viewBox="${label}" must sit on its parent's edge via bottom:100%, not a hand-tuned negative top`);
}
console.log(`${caps.length} snow caps: path bottom == viewBox bottom, all placed with bottom:100%`);

console.log('\nALL SNOW CHECKS PASSED');
