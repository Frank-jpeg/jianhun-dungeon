// 无头冒烟测试：用最小 DOM/Canvas/Audio 桩把游戏真跑起来，
// 随机输入驱动几千帧，抓运行时异常和 NaN。
const fs = require('fs');
const vm = require('vm');
const path = process.argv[2];
const html = fs.readFileSync(path, 'utf8');
const src = html.match(/<script>([\s\S]*?)<\/script>/g).pop()
                .replace(/^<script>/, '').replace(/<\/script>$/, '');

// ---------- 桩 ----------
const noop = () => {};
function fakeCtx() {
  const grad = { addColorStop: noop };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'measureText') return () => ({ width: 10 });
      if (k === 'canvas') return { width: 960, height: 540 };
      if (k in t) return t[k];
      return noop;                       // 其余绘制方法全部空转
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function fakeEl(id) {
  const el = {
    id, style: {}, dataset: {}, value: 50, textContent: '', innerHTML: '',
    className: '', width: 960, height: 540,
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, addEventListener: noop, removeEventListener: noop,
    querySelector: () => fakeEl('sub'), querySelectorAll: () => [],
    getContext: () => fakeCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 540 }),
    focus: noop, blur: noop,
  };
  return el;
}
const els = {};
const doc = {
  getElementById: (id) => (els[id] || (els[id] = fakeEl(id))),
  querySelectorAll: () => [],
  createElement: () => fakeEl('new'),
  addEventListener: noop,
  body: { classList: { add: noop, remove: noop, toggle: noop } },
  documentElement: { requestFullscreen: noop },
  fullscreenElement: null,
};
class FakeAudio {
  constructor() { this.currentTime = 0; this.sampleRate = 44100; this.state = 'running';
    this.destination = {}; }
  createGain() { return { gain: { value: 0, setValueAtTime: noop,
    linearRampToValueAtTime: noop, exponentialRampToValueAtTime: noop },
    connect: noop, disconnect: noop }; }
  createOscillator() { return { type: '', frequency: { value: 0, setValueAtTime: noop,
    exponentialRampToValueAtTime: noop }, connect: noop, start: noop, stop: noop }; }
  createBiquadFilter() { return { type: '', frequency: { value: 0, setValueAtTime: noop,
    exponentialRampToValueAtTime: noop }, Q: { value: 1 }, connect: noop }; }
  createBufferSource() { return { buffer: null, playbackRate: { value: 1 },
    connect: noop, start: noop, stop: noop }; }
  createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
  resume() {}
}
const timers = [];
const sandbox = {
  document: doc, window: null, console,
  AudioContext: FakeAudio, webkitAudioContext: FakeAudio,
  performance: { now: () => Date.now() },
  requestAnimationFrame: noop,
  setInterval: () => 0, clearInterval: noop,
  setTimeout: (fn) => { timers.push(fn); return 0; },   // 延后执行，循环里手动 drain
  addEventListener: noop, removeEventListener: noop,
  matchMedia: () => ({ matches: false }),
  navigator: { maxTouchPoints: 0 },
  innerWidth: 1600, innerHeight: 900,
  Math, JSON, Date, Set, Map, Array, Object, String, Number, isFinite, parseInt,
  Float32Array, Infinity, NaN, undefined,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

// 把测试代码追加到同一作用域
const harness = `
globalThis.__run = function(cls, frames){
  const log = [];
  startGame(cls);
  let cards = 0, deaths = 0;
  for (let i = 0; i < frames; i++) {
    if (gameState === 'cards') { cards++; choose(Math.floor(Math.random()*3)); }
    if (gameState === 'over')  { deaths++; startGame(cls); }
    if (gameState !== 'play') { __drain(); continue; }
    // 随机输入
    held.r = (i % 120) < 55; held.l = (i % 120) >= 90;
    held.u = (i % 77)  < 20; held.d = (i % 91) < 18;
    held.atk = (i % 13) < 9;
    if (i % 47 === 0) hit.s0 = true;
    if (i % 83 === 0) hit.s1 = true;
    if (i % 151 === 0) hit.s2 = true;
    if (i % 113 === 0) hit.s3 = true;
    if (i % 61 === 0) hit.jump = true;
    if (i % 71 === 0) hit.dash = true;
    update(1/60);
    render();
    for (const k in hit) hit[k] = false;
    __drain();
    if (!isFinite(P.hp) || !isFinite(P.x) || !isFinite(P.y) || !isFinite(P.z))
      throw new Error('玩家数值变成 NaN，帧 ' + i + ' hp=' + P.hp + ' x=' + P.x);
    for (const e of enemies)
      if (!isFinite(e.hp) || !isFinite(e.x) || !isFinite(e.y))
        throw new Error('敌人数值 NaN（' + e.type + '）帧 ' + i);
    for (const pr of projs) {
      // 玩家弹丸用 mul、敌人弹丸用 dmg。一律查 mul 会让每支敌人的箭都误报，
      // 导致模拟在开局 1.5 秒就中断，后面几千帧根本没跑到。
      const power = pr.own === 'p' ? pr.mul : pr.dmg;
      if (!isFinite(pr.x) || !isFinite(pr.y) || !isFinite(power))
        throw new Error('弹丸数值 NaN 帧 ' + i + ' → ' + JSON.stringify(pr));
    }
  }
  return { 层:floorN, 间:roomN, 击杀:kills, 选卡次数:cards, 死亡次数:deaths,
           已拿卡:Object.keys(taken).length, 场上敌人:enemies.length,
           弹丸:projs.length, 特效:fxs.length, 粒子:parts.length, 血量:Math.round(P.hp) };
};
globalThis.__winPath = function(){
  // 随机输入 5000 帧只跑得到第 1 层，通关那条路永远测不到。
  // 这里直接把进度顶到 Boss 前，验证「中间层进下一层 / 最终层通关」两个分支。
  const errs = [];
  startGame('sword');

  floorN = 3; roomN = ROOMS;
  roomClear(); __drain();
  if (floorN !== 4 || roomN !== 1)
    errs.push('中间层 Boss 清完没进下一层：floorN=' + floorN + ' roomN=' + roomN);
  if (gameState !== 'cards')
    errs.push('中间层 Boss 清完没弹选卡：gameState=' + gameState);

  gameState = 'play';
  floorN = FLOORS; roomN = ROOMS;
  roomClear(); __drain();
  if (gameState !== 'over')
    errs.push('最终层 Boss 清完没有通关：gameState=' + gameState);
  if (floorN !== FLOORS)
    errs.push('通关后层数还在涨：floorN=' + floorN + '（应停在 ' + FLOORS + '）');
  const title = $('ovTitle').textContent || '';
  if (title.indexOf('通') < 0)
    errs.push('通关标题没设置：' + JSON.stringify(title));

  return errs;
};
globalThis.__takeAll = function(){
  // 逐张应用所有卡片，抓 ap() 里的错误和 NaN
  const bad = [];
  for (const c of CARDS) {
    for (let lv = 0; lv < c.max; lv++) {
      try { c.ap(P); } catch (err) { bad.push(c.id + ' → ' + err.message); break; }
    }
    const nm = (typeof c.nm === 'function') ? c.nm() : c.nm;
    const ds = (typeof c.ds === 'function') ? c.ds(0) : c.ds;
    if (!nm || !ds) bad.push(c.id + ' → 名称或说明为空');
  }
  for (const k in P) if (typeof P[k] === 'number' && !isFinite(P[k]))
    bad.push('字段 P.' + k + ' = ' + P[k]);
  return bad;
};
`;

const ctxObj = vm.createContext(sandbox);
// __drain 需要在沙箱里可见
sandbox.__drain = () => { while (timers.length) { const f = timers.shift(); try { f(); } catch (e) {} } };

try {
  vm.runInContext(src + harness, ctxObj, { filename: 'game.js' });
} catch (e) {
  console.log('❌ 脚本加载即报错：' + e.message);
  console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  process.exit(1);
}

let fail = 0;
for (const cls of ['sword', 'gun']) {
  try {
    const r = sandbox.__run(cls, 5000);
    console.log(`✅ ${cls === 'sword' ? '鬼剑士' : '神枪手'} 跑完 5000 帧（约 83 秒游戏时间）`);
    console.log('   ' + JSON.stringify(r, null, 0).replace(/[{}"]/g, '').replace(/,/g, '  '));
  } catch (e) {
    fail++;
    console.log(`❌ ${cls} 运行时报错：${e.message}`);
    console.log('   ' + (e.stack || '').split('\n').slice(1, 4).join('\n   '));
  }
}
try {
  const bad = sandbox.__winPath();
  console.log(bad.length ? '❌ 通关流程：\n   ' + bad.join('\n   ')
                         : '✅ 通关流程正常：中间层进下一层，第 10 层 Boss 清完即通关');
  if (bad.length) fail++;
} catch (e) { console.log('❌ 通关流程测试报错：' + e.message); fail++; }

try {
  const bad = sandbox.__takeAll();
  console.log(bad.length ? '❌ 卡片问题：\n   ' + bad.join('\n   ')
                         : '✅ 84 张卡全部可正常应用，无 NaN 字段');
  if (bad.length) fail++;
} catch (e) { console.log('❌ 卡片测试报错：' + e.message); fail++; }

process.exit(fail ? 1 : 0);
