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
const lsStore = {};
const sandbox = {
  document: doc, window: null, console,
  AudioContext: FakeAudio, webkitAudioContext: FakeAudio,
  localStorage: {
    getItem: (k) => (k in lsStore ? lsStore[k] : null),
    setItem: (k, v) => { lsStore[k] = String(v); },
    removeItem: (k) => { delete lsStore[k]; },
  },
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
  // 这里直接把进度顶到 Boss 前，验证三段：中间层进下一层 / 巨魔王 / 虚影关。
  const errs = [];
  const ngPick0 = ngPick;
  startGame('sword');

  // ---- 中间层：Boss 清完进下一层 ----
  floorN = 3; roomN = ROOMS;
  roomClear(); __drain();
  if (floorN !== 4 || roomN !== 1)
    errs.push('中间层 Boss 清完没进下一层：floorN=' + floorN + ' roomN=' + roomN);
  if (gameState !== 'cards')
    errs.push('中间层 Boss 清完没弹选卡：gameState=' + gameState);

  // ---- 巨魔王：通关这一刻就成立（存档先落地），但不结算 —— 后面还有虚影关 ----
  gameState = 'play';
  floorN = FLOORS; roomN = ROOMS;
  roomClear(); __drain();
  if (gameState !== 'cards')
    errs.push('巨魔王清完没进选卡：gameState=' + gameState);
  if (!mirrorPending)
    errs.push('巨魔王清完没安排虚影关：mirrorPending=' + mirrorPending);
  if (!winInfo)
    errs.push('巨魔王清完没立刻记通关 —— 打输虚影就会把通关掉掉');
  if (!(SAVE.best[ngLevel] || {}).cleared)
    errs.push('巨魔王清完存档里没写 cleared');
  if (SAVE.ngMax < 2)
    errs.push('巨魔王清完没解锁下一周目：ngMax=' + SAVE.ngMax);
  if (floorN !== FLOORS)
    errs.push('通关后层数还在涨：floorN=' + floorN + '（应停在 ' + FLOORS + '）');

  // ---- 进虚影关：场上只有虚影、回满血、没有波次和词条 ----
  P.hp = 1;                                   // 验证进门回满血
  choose(0); __drain();
  if (gameState !== 'play')  errs.push('选完卡没开打：gameState=' + gameState);
  if (!mirrorRoom)           errs.push('选完卡没进虚影关：mirrorRoom=false');
  if (mirrorPending)         errs.push('进了虚影关 mirrorPending 没清 —— 会再排一间');
  if (P.hp !== P.maxHp)      errs.push('虚影关没回满血：' + P.hp + ' / ' + P.maxHp);
  if (waves.length !== 0)    errs.push('虚影关不该有波次：waves=' + waves.length);
  if (roomAffix)             errs.push('虚影关不该带词条：' + roomAffix);
  if (enemies.length !== 1 || !enemies[0].mirror)
    errs.push('虚影关场上不是唯一一个虚影：' + enemies.length + ' 个敌人');
  else {
    const m = enemies[0];
    if (!isFinite(m.hp)  || m.hp  <= 0) errs.push('虚影血量异常：' + m.hp);
    if (!isFinite(m.atk) || m.atk <= 0) errs.push('虚影伤害异常：' + m.atk);
    if (!isFinite(m.spd) || m.spd <= 0) errs.push('虚影移速异常：' + m.spd);
  }

  // ---- 打倒虚影 → 真结局。走 update() 的清屋判定，顺带验证「waves 空也能清屋」 ----
  enemies.length = 0;
  update(1 / 60); __drain();
  if (gameState !== 'over')
    errs.push('虚影倒下没有结算：gameState=' + gameState);
  const title = $('ovTitle').textContent || '';
  if (title.indexOf('真') < 0)
    errs.push('打倒虚影没给真结局标题：' + JSON.stringify(title));

  // ---- 反例：死在虚影手里。通关早已落地，不许显示「你倒下了」 ----
  ngPick = 1;                                 // 钉死周目，别被上面刚解锁的第 2 周目带跑
  startGame('sword');
  gameState = 'play'; floorN = FLOORS; roomN = ROOMS;
  roomClear(); __drain();                     // 巨魔王倒下 → 通关落地
  choose(0); __drain();                       // 进虚影关
  gameOver();                                 // 这一局死在虚影手里
  const lost = $('ovTitle').textContent || '';
  if (lost.indexOf('通') < 0)
    errs.push('死在虚影手里把通关判没了：' + JSON.stringify(lost));
  if (!(SAVE.best[ngLevel] || {}).cleared)
    errs.push('死在虚影手里，存档的通关标记被冲掉了');

  ngPick = ngPick0;
  return errs;
};
globalThis.__records = function(){
  const errs = [];

  // ---- 存档层：file:// 下浏览器可能直接禁掉 localStorage 并抛异常，必须静默降级 ----
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem(){ throw new Error('blocked'); },
    setItem(){ throw new Error('blocked'); },
  };
  try {
    if (loadSave().ngMax !== 1) errs.push('localStorage 被禁时 loadSave 没退回默认值');
    writeSave();                                   // 不许抛出去
  } catch (e) {
    errs.push('localStorage 被禁时存档层抛了异常：' + e.message);
  }
  globalThis.localStorage = real;

  // ---- recordRun：三个指标各走各的，不许互相覆盖 ----
  SAVE.ngMax = 1; for (const k in SAVE.best) delete SAVE.best[k];
  ngLevel = 1;

  floorN = 4; roomN = 2; kills = 100;
  if (!recordRun(false, 300)) errs.push('第一次留记录应该算破纪录');

  floorN = 3; roomN = 1; kills = 500;             // 更浅但杀得更多
  recordRun(false, 200);
  let b = SAVE.best[1];
  if (b.floor !== 4 || b.room !== 2) errs.push('更浅的一局把最深纪录冲掉了：' + b.floor + '-' + b.room);
  if (b.kills !== 500) errs.push('击杀纪录没取历史最大：' + b.kills);

  floorN = FLOORS; roomN = ROOMS; kills = 200;    // 首次通关
  if (!recordRun(true, 600)) errs.push('首次通关应该算破纪录');
  b = SAVE.best[1];
  if (!b.cleared || b.time !== 600) errs.push('通关时间没记上：' + JSON.stringify(b));
  if (b.kills !== 500) errs.push('通关把击杀纪录冲掉了：' + b.kills);

  if (recordRun(true, 900)) errs.push('更慢的通关不该算新纪录');
  if (SAVE.best[1].time !== 600) errs.push('更慢的通关覆盖了最佳时间：' + SAVE.best[1].time);
  if (!recordRun(true, 400)) errs.push('更快的通关应该算新纪录');

  // ---- 周目倍率：血和攻必须同倍率，这是上一轮踩过的坑 ----
  ngLevel = 1; if (ngMul() !== 1) errs.push('第 1 周目倍率应为 1，实际 ' + ngMul());
  floorN = 5; roomN = 3;
  ngLevel = 1; const h1 = scaleHp(), a1 = scaleAtk();
  ngLevel = 3; const h3 = scaleHp(), a3 = scaleAtk();
  if (!(h3 > h1)) errs.push('周目没有放大敌人血量');
  if (Math.abs((h3 / h1) - (a3 / a1)) > 1e-9)
    errs.push('周目对血/攻的放大不一致：血 ×' + (h3 / h1).toFixed(4) + ' 攻 ×' + (a3 / a1).toFixed(4));

  // ---- 通关解锁下一周目 ----
  SAVE.ngMax = 1; ngPick = 1;
  startGame('sword');
  gameState = 'play'; floorN = FLOORS; roomN = ROOMS;
  roomClear(); __drain();
  if (SAVE.ngMax !== 2) errs.push('通关后没解锁第 2 周目：ngMax=' + SAVE.ngMax);

  ngLevel = 1; ngPick = 1;
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
                         : '✅ 通关流程正常：中间层进下一层，巨魔王倒下即通关，虚影关是通关之后的额外决战');
  if (bad.length) fail++;
} catch (e) { console.log('❌ 通关流程测试报错：' + e.message); fail++; }

try {
  const bad = sandbox.__records();
  console.log(bad.length ? '❌ 记录 / 周目：\n   ' + bad.join('\n   ')
                         : '✅ 记录与周目正常：存档可降级、三项纪录互不覆盖、通关解锁下一周目');
  if (bad.length) fail++;
} catch (e) {
  console.log('❌ 记录 / 周目测试报错：' + e.message);
  console.log('   ' + (e.stack || '').split('\n').slice(1, 4).join('\n   '));
  fail++;
}

try {
  const bad = sandbox.__takeAll();
  console.log(bad.length ? '❌ 卡片问题：\n   ' + bad.join('\n   ')
                         : '✅ 84 张卡全部可正常应用，无 NaN 字段');
  if (bad.length) fail++;
} catch (e) { console.log('❌ 卡片测试报错：' + e.message); fail++; }

process.exit(fail ? 1 : 0);
