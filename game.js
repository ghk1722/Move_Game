"use strict";

/* ============================================================
   월드컵 핸드 골키퍼 · 2026 A조
   - 웹캠으로 양손을 추적해 골키퍼 장갑으로 슛을 막는다
   - 국가 선택 → 골키퍼 선택 → 조별리그 3경기 → 32강 진출 결정
   ============================================================ */

const { COUNTRIES, getCountry } = window.WC;

// ---- DOM ----
const videoEl = document.getElementById("video");
const canvas  = document.getElementById("canvas");
const ctx     = canvas.getContext("2d");
const threeCanvas = document.getElementById("three");
const fxCanvas = document.getElementById("fx");
const ctxFx   = fxCanvas.getContext("2d");
const bg3dCanvas = document.getElementById("bg3d");
const uiEl    = document.getElementById("ui");
const trackEl = document.getElementById("track");
const adminBtn = document.getElementById("adminBtn");
const strikerExitBtn = document.getElementById("strikerExit");
const hudEl   = document.getElementById("hud");
const hudMatch = document.getElementById("hudMatch");
const hudScore = document.getElementById("hudScore");
const hudShots = document.getElementById("hudShots");
const hudHands = document.getElementById("hudHands");

// ---- 캔버스 크기 ----
let W = 0, H = 0;
function resize() {
  W = canvas.width = innerWidth; H = canvas.height = innerHeight;
  fxCanvas.width = W; fxCanvas.height = H;
  try { NET.built = false; } catch (e) {}
  try { if (three && three.renderer) { three.renderer.setSize(W, H, false); three.camera.aspect = W/H; three.camera.updateProjectionMatrix(); } } catch (e) {}
  try { if (bg && bg.renderer) { bg.renderer.setSize(W, H, false); bg.camera.aspect = W/H; bg.camera.updateProjectionMatrix(); } } catch (e) {}
}
addEventListener("resize", resize); resize();

// ---- 공용 수학 헬퍼 ----
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);   // 구간 정규화 0~1
function rp(x, y, l, a) { return [x + Math.cos(a) * l, y + Math.sin(a) * l]; }
function shade(hex, amt) {
  let c = (hex || "#888888").replace("#", "");
  if (c.length === 3) c = c.split("").map(x => x + x).join("");
  const r = clamp(parseInt(c.slice(0,2),16) + amt, 0, 255);
  const g = clamp(parseInt(c.slice(2,4),16) + amt, 0, 255);
  const b = clamp(parseInt(c.slice(4,6),16) + amt, 0, 255);
  return `rgb(${r|0},${g|0},${b|0})`;
}

// ---- 사운드 (WebAudio, 외부 파일 없이 합성) ----
let AC = null;
function audioInit() {
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    if (AC && AC.state === "suspended") AC.resume();
  } catch (e) {}
}
function playSlap() {
  if (!AC) return;
  const t = AC.currentTime, dur = 0.13;
  // 짝! = 밴드패스된 노이즈 버스트
  const buf = AC.createBuffer(1, Math.floor(AC.sampleRate * dur), AC.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random()*2 - 1) * Math.pow(1 - i/d.length, 3);
  const src = AC.createBufferSource(); src.buffer = buf;
  const bp = AC.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 2000; bp.Q.value = 0.7;
  const g = AC.createGain(); g.gain.setValueAtTime(1.0, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(AC.destination); src.start(t);
  // 묵직한 타격감(저음)
  const o = AC.createOscillator(); o.type = "sine";
  o.frequency.setValueAtTime(170, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.1);
  const g2 = AC.createGain(); g2.gain.setValueAtTime(0.6, t); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g2); g2.connect(AC.destination); o.start(t); o.stop(t + 0.14);
}
function playKick() {
  if (!AC) return;
  const t = AC.currentTime;
  const o = AC.createOscillator(); o.type = "triangle";
  o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.09);
  const g = AC.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + 0.13);
}

// ---- 난이도 레벨 (공 속도 / 코스 / 헤딩 비율) ----
const LEVELS = [
  { key:"easy",   label:"쉬움",       emoji:"🐣", speedMul:0.85, spread:0.70, header:0.22, curve:0.08, windup:1250, desc:"느린 슛 · 가운데 위주" },
  { key:"normal", label:"보통",       emoji:"⚽", speedMul:1.10, spread:1.00, header:0.30, curve:0.16, windup:1100, desc:"표준 속도 · 가끔 감아차기" },
  { key:"hard",   label:"어려움",     emoji:"🔥", speedMul:1.45, spread:1.28, header:0.36, curve:0.28, windup:1000, desc:"빠른 슛 · 구석 · 발리/감아차기" },
  { key:"world",  label:"월드클래스", emoji:"🏆", speedMul:1.85, spread:1.55, header:0.40, curve:0.40, windup:900,  desc:"강슛 · 날카로운 코스 · 다양한 슛" },
  { key:"legend", label:"레전드",     emoji:"👑", speedMul:2.25, spread:1.95, header:0.34, curve:0.58, windup:780, legend:true, desc:"실제 선수급 — 구석 강슛·급커브, 막기 극악" },
];

// ============================================================
//  전체 게임(토너먼트) 상태
// ============================================================
const GAME = {
  screen: "boot",        // boot|country|keeper|intro|play|matchresult|standings|final
  tracking: false,
  userCode: null,
  keeper: null,
  opponents: [],         // 상대 3개국 코드 (경기 순서)
  matchIndex: 0,
  difficulty: null,      // 선택한 난이도 레벨
  inputMode: "hand",     // hand | foot (손흥민 찰칵 제스처로 공격수 변신)
  returnScreen: null,    // 변신 전 화면(복귀용)
  table: {},             // code -> {pts,gf,ga,pld,w,d,l}
  lastResults: [],       // 직전 매치데이의 모든 경기 결과 텍스트
  match: null,           // 현재 경기 진행 상태
};

const SHOTS_PER_MATCH = 5;

function initTable() {
  GAME.table = {};
  for (const c of COUNTRIES) {
    GAME.table[c.code] = { pts: 0, gf: 0, ga: 0, pld: 0, w: 0, d: 0, l: 0 };
  }
}

// ============================================================
//  손 추적 (MediaPipe Hands) — 화면엔 영상 미표시, 추적 전용
// ============================================================
let hands = []; // [{x,y,r,landmarks,label}]  (x: 거울 반영된 0~1)

function onResults(results) {
  hands = [];
  const lms = results.multiHandLandmarks || [];
  const handedness = results.multiHandedness || [];
  for (let i = 0; i < lms.length; i++) {
    const lm = lms[i];
    const idx = [0, 5, 9, 13, 17];
    let cx = 0, cy = 0;
    for (const k of idx) { cx += lm[k].x; cy += lm[k].y; }
    cx /= idx.length; cy /= idx.length;
    const span = Math.hypot(lm[12].x - lm[0].x, lm[12].y - lm[0].y);
    hands.push({
      x: 1 - cx,                       // 거울 모드
      y: cy,
      r: Math.max(0.045, span * 0.6),  // 정규화 글러브 반지름 (더 작게)
      landmarks: lm,
      label: handedness[i] ? handedness[i].label : "",
    });
  }
  checkCameraGesture();
}

// ---- 손흥민 "찰칵" 제스처(양손으로 직사각형) 감지 → 공격수 변신 ----
function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function isFrameHand(lm) {                 // 검지 펴고 중지·약지·새끼 접음(L/ㄱ자)
  const w = lm[0];
  const idxExt = dist2(lm[8], w) > dist2(lm[6], w) * 1.12;
  const midF   = dist2(lm[12], w) < dist2(lm[10], w) * 1.05;
  const ringF  = dist2(lm[16], w) < dist2(lm[14], w) * 1.05;
  const pinkF  = dist2(lm[20], w) < dist2(lm[18], w) * 1.05;
  return idxExt && midF && ringF && pinkF;
}
let gestureFrames = 0;
function checkCameraGesture() {
  if (!GAME.tracking || GAME.inputMode !== "hand" || GAME.screen === "striker") { gestureFrames = 0; return; }
  const ok = hands.length >= 2 && isFrameHand(hands[0].landmarks) && isFrameHand(hands[1].landmarks)
             && dist2(hands[0].landmarks[0], hands[1].landmarks[0]) > 0.12;   // 두 손이 떨어져 직사각형
  gestureFrames = ok ? gestureFrames + 1 : 0;
  if (gestureFrames >= 12) { gestureFrames = 0; enterStrikerMode(); }
}

// ---- 발(전신) 추적: MediaPipe Pose ----
let feet = [];          // [{side,x,y,vis}]  (x 거울 반영)
let mpPose = null;
function onPoseResults(res) {
  const lm = res.poseLandmarks;
  feet = [];
  if (lm) {
    // [발끝(foot index), 발목(ankle)] — 왼:31/27, 오른:32/28
    for (const [side, toe, ank] of [[0,31,27],[1,32,28]]) {
      const p = (lm[toe] && lm[toe].visibility > 0.4) ? lm[toe] : lm[ank];
      if (p && p.visibility > 0.35) feet.push({ side, x: 1 - p.x, y: p.y, vis: p.visibility });
    }
  }
}
function ensurePose() {
  if (mpPose) return;
  mpPose = new Pose({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${f}` });
  mpPose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
  mpPose.onResults(onPoseResults);
}

let mpHands = null, mpCamera = null;
async function initTracking() {
  mpHands = new Hands({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4/${f}` });
  mpHands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.5, minTrackingConfidence: 0.45 });
  mpHands.onResults(onResults);
  mpCamera = new Camera(videoEl, {
    onFrame: async () => {
      if (GAME.inputMode === "foot" && mpPose) await mpPose.send({ image: videoEl });
      else await mpHands.send({ image: videoEl });
    },
    width: 1280, height: 720,
  });
  await mpCamera.start();
  GAME.tracking = true;
  trackEl.classList.remove("hidden");
}

// 손 인식 상태 배지 갱신 (모든 화면)
function updateTrackBadge() {
  if (!GAME.tracking) return;
  if (GAME.inputMode === "foot") {     // 공격수 변신 — 발 인식
    if (feet.length) { trackEl.textContent = `🦵 발 인식됨 (${feet.length})`; trackEl.style.color = "#22d3ee"; }
    else { trackEl.textContent = "🦵 발이 안 보여요 — 뒤로 물러서세요"; trackEl.style.color = "#f87171"; }
    return;
  }
  const n = hands.length;
  if (n >= 2) { trackEl.textContent = "✋✋ 양손 인식됨"; trackEl.style.color = "#4ade80"; }
  else if (n === 1) { trackEl.textContent = "✋ 한 손만 인식 — 양손을 펴 보이세요"; trackEl.style.color = "#fbbf24"; }
  else { trackEl.textContent = "⚠ 손이 안 보여요 — 카메라 앞에 손바닥을 펴세요"; trackEl.style.color = "#f87171"; }
}

// ============================================================
//  3D 배경: 관중석(Stadium Seats) + 관중(crowd) — 플레이 뒤편
// ============================================================
let bg = null;
function initBg() {
  if (bg || typeof THREE === "undefined") return;
  const renderer = new THREE.WebGLRenderer({ canvas: bg3dCanvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  renderer.setClearColor(0x16335e, 1);     // 하늘색(2D 하늘과 연결)
  if ("outputEncoding" in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x16335e, 14, 40);       // 먼 곳 하늘로 페이드
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 300);
  scene.add(new THREE.AmbientLight(0xaeb9d8, 0.95));
  const dl = new THREE.DirectionalLight(0xffffff, 0.55); dl.position.set(-4, 8, 6); scene.add(dl);
  bg = { renderer, scene, camera, ready: false, seats: null, crowd: null };
  const loader = new THREE.GLTFLoader();
  let pending = 2;
  const done = () => { if (--pending === 0) arrangeBg(); };
  loader.load(encodeURI("Stadium Seats.glb"), g => { bg.seats = g.scene; done(); }, undefined, e => { console.warn("seats fail", e); done(); });
  loader.load(encodeURI("crowd.glb"),         g => { bg.crowd = g.scene; done(); }, undefined, e => { console.warn("crowd fail", e); done(); });
}
function darkenObj(obj, k) {
  obj.traverse(o => {
    if (o.isMesh && o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => { if (m.color) m.color.multiplyScalar(k); });
    }
  });
}
function arrangeBg() {
  const root = new THREE.Group();
  // 관중석 구조: 화면 폭 전체로 넓게 깔아 좌우를 채움 (어둡게)
  // 관중석을 살짝 기울여 객석이 카메라를 향하게(관중이 보이도록)
  const TILT = -0.5;
  if (bg.seats) {
    darkenObj(bg.seats, 0.32);                 // 어둡게(차분한 배경)
    for (let i = -1; i <= 1; i++) { const s = bg.seats.clone(); s.position.x = i * 21; s.rotation.x = TILT; root.add(s); }
  }
  // 관중: 기운 객석을 따라 채움(가로 전체) — 어둡게 가라앉힘
  if (bg.crowd) {
    darkenObj(bg.crowd, 0.42);
    const cols = 9, rows = 3;
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const c = bg.crowd.clone(); c.scale.setScalar(1.05);
      const depth = (j - (rows - 1) / 2) * 2.6;
      c.rotation.x = TILT;
      c.position.set((i - (cols - 1) / 2) * 4.6, 1.0 - depth * Math.sin(TILT), depth * Math.cos(TILT));
      root.add(c);
    }
  }
  const center = new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3());
  root.position.x -= center.x; root.position.y -= center.y; root.position.z -= center.z;
  root.position.y += 1.2;
  bg.scene.add(root); bg.root = root;
  // 카메라: 원경에서 살짝 올려다봄(차분한 원경 스탠드)
  bg.camera.position.set(0, 3.2, 24);
  bg.camera.lookAt(0, 2.2, 0);
  bg.camera.updateProjectionMatrix();
  bg.ready = true;
}
function renderBg() {
  if (bg && bg.renderer) bg.renderer.render(bg.scene, bg.camera);
}

// ============================================================
//  공통 드로잉: 경기장 배경 (2D)
// ============================================================
function drawStadium(showGoal = true) {
  // 하늘
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  sky.addColorStop(0, "#0b1733");
  sky.addColorStop(1, "#16335e");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 관중석
  ctx.fillStyle = "#0d1b2a";
  ctx.fillRect(0, H * 0.30, W, H * 0.22);
  // 관중 점묘
  ctx.save();
  for (let y = H * 0.31; y < H * 0.50; y += 7) {
    for (let x = (y % 14); x < W; x += 9) {
      const c = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
      ctx.fillStyle = c > 0.6 ? "rgba(255,255,255,0.10)" : "rgba(120,160,220,0.08)";
      ctx.fillRect(x, y, 3, 3);
    }
  }
  ctx.restore();

  // 잔디
  const grass = ctx.createLinearGradient(0, H * 0.50, 0, H);
  grass.addColorStop(0, "#1f7a3a");
  grass.addColorStop(1, "#15602c");
  ctx.fillStyle = grass;
  ctx.fillRect(0, H * 0.50, W, H * 0.50);
  // 잔디 줄무늬(원근)
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  for (let i = 0; i < 8; i += 2) {
    const y0 = H * 0.50 + (H * 0.50) * (i / 8);
    const y1 = H * 0.50 + (H * 0.50) * ((i + 1) / 8);
    ctx.fillRect(0, y0, W, y1 - y0);
  }

  if (showGoal) drawGoalFrame();
}

// 골대(골키퍼 시점이라 화면을 거의 가득 채움)
function goalRect() {
  const m = Math.min(W, H) * 0.05;
  return { x: m, y: H * 0.12, w: W - m * 2, h: H * 0.64 };
}
// ---- 골 그물: 질량-스프링 시뮬레이션 (골 시 물리적으로 출렁) ----
const NET = { cols: 17, rows: 11, nodes: [], built: false, x:0, y:0, w:0, h:0 };
const netIdx = (c, r) => r * NET.cols + c;
function buildNet() {
  const g = goalRect();
  NET.x = g.x; NET.y = g.y; NET.w = g.w; NET.h = g.h;
  NET.nodes = [];
  for (let r = 0; r < NET.rows; r++) {
    for (let c = 0; c < NET.cols; c++) {
      const x = g.x + g.w * (c/(NET.cols-1));
      const y = g.y + g.h * (r/(NET.rows-1));
      // 테두리(골대 프레임)는 고정
      const pinned = (r === 0 || c === 0 || c === NET.cols-1 || r === NET.rows-1);
      NET.nodes.push({ x, y, px: x, py: y, rx: x, ry: y, pinned, fx: 0, fy: 0 });
    }
  }
  NET.built = true;
}
// 충격: 임팩트 지점 주변 노드에 속도 부여 (공 진행 방향 + 아래로 처짐)
function netImpulse(ix, iy, dx, dy, power) {
  if (!NET.built) buildNet();
  const reach = Math.min(NET.w, NET.h) * 0.55;
  for (const n of NET.nodes) {
    if (n.pinned) continue;
    const d = Math.hypot(n.x - ix, n.y - iy);
    const fall = Math.max(0, 1 - d / reach);
    const f = fall * fall * power;
    n.px -= dx * f; n.py -= dy * f;   // Verlet 속도 = (x - px)
  }
}
function updateNet() {
  if (!NET.built) return;
  const damp = 0.93, anchor = 0.055, nbr = 0.20;
  for (let r = 0; r < NET.rows; r++) for (let c = 0; c < NET.cols; c++) {
    const n = NET.nodes[netIdx(c, r)]; if (n.pinned) continue;
    let fx = (n.rx - n.x) * anchor, fy = (n.ry - n.y) * anchor;
    const nb = [[c-1,r],[c+1,r],[c,r-1],[c,r+1]];
    for (const [cc, rr] of nb) {
      if (cc < 0 || rr < 0 || cc >= NET.cols || rr >= NET.rows) continue;
      const m = NET.nodes[netIdx(cc, rr)];
      fx += (m.x - n.x) * nbr * 0.25; fy += (m.y - n.y) * nbr * 0.25;
    }
    n.fx = fx; n.fy = fy;
  }
  for (const n of NET.nodes) {
    if (n.pinned) continue;
    const vx = (n.x - n.px) * damp, vy = (n.y - n.py) * damp;
    n.px = n.x; n.py = n.y;
    n.x += vx + n.fx; n.y += vy + n.fy + 0.04;   // 약한 중력 처짐
  }
}
function drawNet() {
  if (!NET.built) buildNet();
  ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let r = 0; r < NET.rows; r++) for (let c = 0; c < NET.cols; c++) {
    const n = NET.nodes[netIdx(c, r)];
    if (c < NET.cols-1) { const m = NET.nodes[netIdx(c+1, r)]; ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); }
    if (r < NET.rows-1) { const m = NET.nodes[netIdx(c, r+1)]; ctx.moveTo(n.x, n.y); ctx.lineTo(m.x, m.y); }
  }
  ctx.stroke();
}

function drawGoalFrame() {
  const g = goalRect();
  drawNet();
  // 골포스트
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = 12;
  ctx.lineJoin = "round";
  ctx.strokeRect(g.x, g.y, g.w, g.h);
  ctx.restore();
}

// ============================================================
//  공격수 그리기 (관절 기반 — 런업·임팩트·팔로스루)
// ============================================================
// 2분절 팔다리(허벅지+정강이 / 위팔+아래팔)를 외곽선과 함께 그림
function drawLimb(x0, y0, a1, l1, bend, l2, w, col, endCol, endR) {
  const [x1, y1] = rp(x0, y0, l1, a1);
  const [x2, y2] = rp(x1, y1, l2, a1 + bend);
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,0.32)"; ctx.lineWidth = w * 1.55;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  if (endCol) {  // 발(부츠) 또는 손
    ctx.fillStyle = endCol;
    ctx.beginPath(); ctx.ellipse(x2, y2, endR * 1.15, endR * 0.8, a1 + bend, 0, Math.PI * 2); ctx.fill();
  }
  return [x2, y2];
}

// ---- 골 세리머니 (랜덤) ----
const CELEBS = [
  { name: "손흥민 — 찰칵 📸",            who: "son" },
  { name: "호날두 — 쑤이!! 🔥",          who: "siu" },
  { name: "메시 — 하늘 가리키기 🐐",     who: "sky" },
  { name: "음바페 — 팔짱 ❄️",            who: "fold" },
  { name: "하트 세리머니 💛",            who: "heart" },
  { name: "발로텔리 — Why Always Me 🤷", who: "spread" },
  { name: "무릎 슬라이딩 🛝",            who: "slide" },
  { name: "아기 어르기 👶",              who: "baby" },
  { name: "호날두 — 진정해 ✋",           who: "calm" },
  { name: "비행기 세리머니 ✈️",           who: "airplane" },
  { name: "댑 🕺",                       who: "dab" },
  { name: "근육 자랑 💪",                who: "flex" },
];

function heartPath(cx, cy, sz) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + sz*0.35);
  ctx.bezierCurveTo(cx + sz*1.1, cy - sz*0.5, cx + sz*0.45, cy - sz, cx, cy - sz*0.35);
  ctx.bezierCurveTo(cx - sz*0.45, cy - sz, cx - sz*1.1, cy - sz*0.5, cx, cy + sz*0.35);
  ctx.closePath();
}

// 세리머니별 포즈 파라미터 (팔/다리 각도 · 소품)
function celebPose(who, idle, DN) {
  const upA = -DN, bob = Math.sin(idle * 0.013);
  const p = { bA: upA-0.45+bob*0.2, fA: upA+0.45+bob*0.2, aBend: 0.25,
              kHip: DN+0.22, kBend: 0.3, sHip: DN-0.20, sBend: 0.35,
              lean: -0.05+bob*0.05, vo: null, prop: null };
  switch (who) {
    case "son":     p.bA=upA+0.25; p.fA=upA-0.25; p.aBend=1.5; p.prop="camera"; p.lean=0.04; break;
    case "siu":     p.bA=DN+0.55; p.fA=DN-0.35; p.aBend=0.12; p.kHip=DN+0.55; p.sHip=DN-0.55; p.lean=-0.08; p.vo=0.02; break;
    case "sky":     p.bA=upA-0.12; p.fA=upA+0.08; p.aBend=0.05; break;
    case "fold":    p.bA=DN-0.35; p.fA=DN-0.35; p.aBend=-1.7; p.kHip=DN+0.15; p.sHip=DN-0.12; p.lean=-0.02; p.vo=0.02; break;
    case "heart":   p.bA=upA+0.32; p.fA=upA-0.32; p.aBend=0.95; p.prop="heart"; break;
    case "spread":  p.bA=Math.PI*0.92; p.fA=0.08; p.aBend=0.0; p.kHip=DN+0.4; p.sHip=DN-0.4; p.lean=0; p.vo=0.01; break;
    case "slide":   p.bA=DN+0.8; p.fA=DN+0.6; p.aBend=0.2; p.kHip=DN-0.7; p.kBend=0.2; p.sHip=DN-0.3; p.sBend=1.4; p.lean=-0.5; p.vo=-0.18; break;
    case "baby":    p.bA=DN-0.55; p.fA=DN-0.55; p.aBend=-1.45; p.prop="cradle"; p.lean=0.05+bob*0.08; break;
    case "calm":    p.bA=0.45; p.fA=0.45; p.aBend=0.2; p.lean=0.1; p.vo=0.02; break;
    case "airplane":p.bA=Math.PI*0.95; p.fA=0.05; p.aBend=0; p.lean=0.25; p.kHip=DN-0.3; p.sHip=DN+0.3; break;
    case "dab":     p.bA=upA-0.7; p.fA=upA+1.0; p.aBend=0.6; p.lean=0.15; break;
    case "flex":    p.bA=upA+0.5; p.fA=upA-0.5; p.aBend=1.7; p.lean=0; break;
  }
  return p;
}

function drawCelebProp(prop, hdx, hdy, s, idle) {
  if (prop === "camera") {
    ctx.fillStyle = "#11151f"; ctx.strokeStyle = "#cbd5e1"; ctx.lineWidth = s*0.015;
    roundRect(hdx - 0.13*s, hdy - 0.08*s, 0.26*s, 0.16*s, s*0.03); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2b3445"; ctx.beginPath(); ctx.arc(hdx, hdy, 0.05*s, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#60a5fa"; ctx.beginPath(); ctx.arc(hdx-0.015*s, hdy-0.015*s, 0.02*s, 0, Math.PI*2); ctx.fill();
    if (Math.sin(idle*0.02) > 0.7) { ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.beginPath(); ctx.arc(hdx+0.10*s, hdy-0.07*s, 0.03*s, 0, Math.PI*2); ctx.fill(); }
  } else if (prop === "heart") {
    ctx.fillStyle = "#fbbf24"; heartPath(hdx, hdy - 0.30*s, 0.12*s); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = s*0.015; ctx.stroke();
  } else if (prop === "cradle") {
    ctx.strokeStyle = "#d8a878"; ctx.lineWidth = s*0.05; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, -0.02*s, 0.16*s, Math.PI*0.1, Math.PI*0.9); ctx.stroke();
    ctx.fillStyle = "#f1d6b8"; ctx.beginPath(); ctx.arc(0.12*s, 0.0, 0.05*s, 0, Math.PI*2); ctx.fill();
  }
}

function drawStriker(a) {
  const s = a.scale * Math.min(W, H);
  const t = a.t || 0;
  const celebrate = !!a.celebrate;
  const kind = a.kind || "kick";
  const header   = !celebrate && kind === "header";
  const volley   = !celebrate && kind === "volley";
  const overhead = !celebrate && kind === "overhead";
  const dir = a.side < 0 ? -1 : 1;     // 슛 방향으로 향함 (+x 전방)
  const DN = Math.PI / 2, upA = -DN;
  const idle = a.idle || 0;
  const cp = celebrate ? celebPose(a.celebWho || "son", idle, DN) : null;

  // 동작 단계 (런업 → 백스윙 → 임팩트 → 팔로스루)
  const run    = seg(t, 0, 0.55);
  const load   = seg(t, 0.55, 0.80);
  const strike = seg(t, 0.80, 1.0);
  const follow = seg(t, 1.0, 1.45);
  const cyc = Math.sin(t * Math.PI * 5);                 // 러닝 다리 교차
  const idleBob = Math.sin((a.idle || 0) * 0.005) * 0.012;

  // 수직(점프/바운스/홉) & 웅크림 + 몸 회전(오버헤드)
  let vo, crouch = 0, bodyRot = 0;
  if (celebrate) {
    vo = (cp.vo != null ? cp.vo : 0.03 + Math.abs(Math.sin(idle * 0.013)) * 0.14);
  } else if (overhead) {
    vo = Math.sin(seg(t, 0.45, 1.05) * Math.PI) * 0.62;                 // 높이 점프
    bodyRot = -lerp(0, 2.7, strike) - load * 0.2;                       // 백플립 회전
  } else if (volley) {
    vo = Math.sin(seg(t, 0.5, 1.05) * Math.PI) * 0.30;                  // 중간 점프
  } else if (header) {
    crouch = Math.sin(load * Math.PI) * 0.09;
    vo = Math.sin(seg(t, 0.58, 1.08) * Math.PI) * 0.5;                  // 점프
  } else {
    crouch = Math.sin(load * Math.PI) * 0.06;                           // 플랜트 웅크림
    vo = Math.abs(cyc) * 0.025 * (1 - Math.max(load, strike))           // 러닝 바운스
       + Math.sin(follow * Math.PI) * 0.09 + idleBob;                   // 임팩트 후 홉
  }

  // 런업: 시작점 → 공(플랜트) 위치로 달려 들어옴
  const runFrom = (a.runFrom == null ? a.x : a.runFrom);
  const approach = celebrate ? 1 : run * run * (3 - 2 * run);           // smoothstep
  const pelvisX = lerp(runFrom, a.x, approach) * W;
  const pelvisY = a.y * H - (0.50 - crouch + vo) * s;

  ctx.save();
  ctx.translate(pelvisX, pelvisY);

  // 그림자 (점프 시 작아짐)
  const sh = clamp(1 - vo * 1.3, 0.4, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.30 * sh})`;
  ctx.beginPath();
  ctx.ellipse(0, (0.50 - crouch + vo) * s, 0.22 * s * sh, 0.055 * s * sh, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.scale(dir, 1);
  if (bodyRot) ctx.rotate(bodyRot);

  const jersey = a.color, jerseyDark = shade(a.color, -40);
  const skin = "#d8a878", skinDark = shade("#d8a878", -28), boot = "#14171e", shorts = "#0e1320";

  // 몸통 기울기 (장전 시 뒤로 → 임팩트 때 앞으로 스냅)
  let lean;
  if (celebrate) lean = cp.lean;
  else if (overhead) lean = 0;
  else if (volley) lean = lerp(0, -0.35, load) + lerp(0, 0.25, strike);
  else lean = lerp(0, -0.16, load) + lerp(0, header ? -0.10 : 0.38, strike) + lerp(0, header ? 0.06 : 0.12, follow);
  const torsoAng = -DN + lean;
  const [shx, shy] = rp(0, 0, 0.42 * s, torsoAng);       // 어깨
  const headAng = torsoAng + (header ? lerp(0, 0.42, strike) : 0.06);
  const [hdx, hdy] = rp(shx, shy, 0.17 * s, headAng);

  // 다리 각도
  let supHip = DN + 0.12 - cyc * 0.42 * (1 - Math.max(load, strike));
  let supBend = 0.20 + load * 0.18 + follow * 0.22;
  let kickHip, kickBend;
  if (celebrate) {
    kickHip = cp.kHip; kickBend = cp.kBend; supHip = cp.sHip; supBend = cp.sBend;
  } else if (overhead) {
    kickHip = DN - 1.5 - strike * 0.5; kickBend = 0.2;          // 두 다리 위로 시저스
    supHip  = DN - 1.0 + strike * 0.25; supBend = 0.7;
  } else if (volley) {
    kickHip = DN + load * 0.4 - strike * 1.8;                   // 수평으로 휘두르는 발리
    kickBend = 0.45 + load * 0.4 - strike * 0.55;
    supHip = DN + 0.35; supBend = 0.5;
  } else if (header) {
    kickHip = DN - 0.12 + Math.sin(seg(t, 0.55, 1) * Math.PI) * 0.22;
    kickBend = 0.75;
    supHip = DN + 0.05 + Math.sin(seg(t, 0.55, 1) * Math.PI) * 0.18;
    supBend = 0.6;
  } else {
    kickHip = DN + cyc * 0.55 * (1 - load);   // 러닝 스윙
    kickHip += load * 0.75;                   // 백스윙(다리 뒤로 장전)
    kickHip -= strike * 2.25;                 // 임팩트: 앞·위로 휘두름
    kickHip -= follow * 0.45;                 // 팔로스루
    kickBend = 0.30 + load * 1.05 - strike * 1.30 + follow * 0.35;     // 장전 때 접고 임팩트 때 쭉 폄
    supBend = 0.18 + load * 0.30 + Math.sin(follow * Math.PI) * 0.5;   // 플랜트 굽힘 → 홉
    supHip  = DN + 0.14 - cyc * 0.42 * (1 - Math.max(load, strike)) - Math.sin(follow * Math.PI) * 0.35;
  }

  // 팔 각도(다리와 반대로 스윙해 자연스럽게)
  let backArmA, frontArmA, armBend = 0.55;
  if (celebrate) {
    backArmA = cp.bA; frontArmA = cp.fA; armBend = cp.aBend;
  } else if (overhead) {
    backArmA = upA - 0.4; frontArmA = upA + 0.6; armBend = 0.4;        // 균형 위해 벌림
  } else if (volley) {
    backArmA = Math.PI * 0.9; frontArmA = 0.2 - strike * 0.4; armBend = 0.4;
  } else if (header) {
    backArmA  = upA - 0.55 - Math.sin(seg(t,0.55,1)*Math.PI)*0.5;
    frontArmA = upA - 0.35 - Math.sin(seg(t,0.55,1)*Math.PI)*0.6;
    armBend = 0.4;
  } else {
    const swing = cyc * 0.8 * (1 - Math.max(load, strike));
    backArmA  = -2.45 + load * 0.35 - swing - strike * 0.25;   // 균형 잡는 팔(뒤·위로 벌림)
    frontArmA = 0.55 - strike * 0.8 + swing;                   // 앞으로 뻗는 팔
    armBend = 0.5;
  }
  const armLen = 0.18 * s, handR = 0.05 * s, footR = 0.07 * s;

  // ===== 뒤쪽 팔/다리 (몸통 뒤) =====
  drawLimb(shx, shy, backArmA, armLen, -armBend, armLen * 0.95, 0.07 * s, skinDark, skinDark, handR);
  drawLimb(0, 0.02 * s, supHip, 0.26 * s, supBend, 0.26 * s, 0.085 * s, skinDark, shade(boot,-10), footR);

  // ===== 몸통(유니폼) =====
  const hipL = -0.08 * s, hipR = 0.08 * s;
  const shL = shx - 0.11 * s, shR = shx + 0.11 * s;
  ctx.fillStyle = jersey;
  ctx.strokeStyle = jerseyDark; ctx.lineWidth = s * 0.02; ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(hipL, 0); ctx.lineTo(shL, shy); ctx.lineTo(shR, shy); ctx.lineTo(hipR, 0); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // 등번호 느낌의 음영
  ctx.fillStyle = jerseyDark;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(shR, shy); ctx.lineTo(hipR,0); ctx.closePath(); ctx.fill();
  // 반바지
  ctx.fillStyle = shorts;
  ctx.beginPath();
  ctx.moveTo(hipL, -0.01*s); ctx.lineTo(hipR, -0.01*s); ctx.lineTo(0.10*s, 0.10*s); ctx.lineTo(-0.10*s, 0.10*s); ctx.closePath();
  ctx.fill();

  // ===== 머리 =====
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(hdx, hdy, 0.10 * s, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = s*0.012; ctx.stroke();
  // 머리카락
  ctx.fillStyle = "#1a1410";
  ctx.beginPath(); ctx.arc(hdx, hdy - 0.02*s, 0.10*s, Math.PI*1.05, Math.PI*2.05); ctx.fill();

  // ===== 앞쪽 다리/팔 =====
  drawLimb(0, 0.02 * s, kickHip, 0.26 * s, kickBend, 0.26 * s, 0.09 * s, skin, boot, footR);
  // 차는 발 임팩트 순간 살짝 번쩍
  if (!celebrate && !header && !overhead && strike > 0.2 && strike < 1) {
    const [fx, fy] = rp(...rp(0, 0.02*s, 0.26*s, kickHip), 0.26*s, kickHip + kickBend);
    ctx.fillStyle = `rgba(255,255,255,${0.5*strike})`;
    ctx.beginPath(); ctx.arc(fx, fy, footR*1.3, 0, Math.PI*2); ctx.fill();
  }
  drawLimb(shx, shy, frontArmA, armLen, armBend, armLen * 0.95, 0.075 * s, skin, skin, handR);

  // 세리머니 소품(카메라/하트/아기)
  if (celebrate && cp.prop) drawCelebProp(cp.prop, hdx, hdy, s, idle);

  ctx.restore();
}

// ============================================================
//  골키퍼 장갑 그리기 (양손)
// ============================================================
function strokeChain(pts, idxs, w, col) {
  ctx.strokeStyle = col; ctx.lineWidth = w;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.beginPath();
  idxs.forEach((i, k) => { const [x, y] = pts[i]; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
}
function drawGloves(gloveColor) {
  const minWH = Math.min(W, H);
  const dark = shade(gloveColor, -45), light = shade(gloveColor, 55);
  const FINGERS = [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];

  for (const h of hands) {
    const lm = h.landmarks;
    const pts = lm.map(p => [(1 - p.x) * W, p.y * H]);
    const hr = h.r * minWH;
    if (hr < 4) continue;
    const cx = pts[9][0], cy = pts[9][1];

    // 부드러운 글로우 (작게)
    const gr = ctx.createRadialGradient(cx, cy, hr * 0.2, cx, cy, hr * 1.05);
    gr.addColorStop(0, gloveColor + "44"); gr.addColorStop(1, gloveColor + "00");
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(cx, cy, hr * 1.05, 0, Math.PI * 2); ctx.fill();

    const fW = hr * 0.40;   // 손가락 두께

    // 손가락: 어두운 외곽선 → 본색
    for (const f of FINGERS) {
      strokeChain(pts, [0, ...f], fW * 1.3, dark);
    }
    for (const f of FINGERS) {
      strokeChain(pts, [0, ...f], fW, gloveColor);
    }
    // 손바닥 채움 (볼록 다각형)
    ctx.fillStyle = gloveColor;
    ctx.strokeStyle = dark; ctx.lineWidth = hr * 0.08; ctx.lineJoin = "round";
    ctx.beginPath();
    [0,1,5,9,13,17].forEach((i,k)=>{const[x,y]=pts[i]; k?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.closePath(); ctx.fill(); ctx.stroke();

    // 손가락 끝 캡
    ctx.fillStyle = light;
    for (const f of FINGERS) {
      const [x, y] = pts[f[3]];
      ctx.beginPath(); ctx.arc(x, y, fW * 0.46, 0, Math.PI * 2); ctx.fill();
    }
    // 손등 하이라이트 + 스티칭
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath(); ctx.arc(cx, cy, hr * 0.30, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = Math.max(1, hr * 0.035);
    for (const i of [5, 9, 13]) {
      const a = pts[0], b = pts[i];
      ctx.beginPath();
      ctx.moveTo(lerp(a[0],b[0],0.35), lerp(a[1],b[1],0.35));
      ctx.lineTo(lerp(a[0],b[0],0.80), lerp(a[1],b[1],0.80));
      ctx.stroke();
    }
    // 손목 커프(흰 테두리 + 색 중앙)
    const wp = pts[0];
    ctx.fillStyle = "#ffffff"; ctx.strokeStyle = dark; ctx.lineWidth = hr * 0.05;
    ctx.beginPath(); ctx.arc(wp[0], wp[1], hr * 0.30, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = gloveColor;
    ctx.beginPath(); ctx.arc(wp[0], wp[1], hr * 0.17, 0, Math.PI * 2); ctx.fill();
  }
}

// ============================================================
//  파티클
// ============================================================
let particles = [];
function burst(x, y, color, n = 20) {
  for (let i = 0; i < n; i++) {
    const ang = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 8;
    particles.push({ x, y, vx: Math.cos(ang)*sp, vy: Math.sin(ang)*sp, life: 1, color, size: 2+Math.random()*4 });
  }
}
function updateParticles(dt) {
  for (const p of particles) { p.x += p.vx; p.y += p.vy; p.vy += 0.18; p.life -= dt/700; }
  particles = particles.filter(p => p.life > 0);
}
function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = `rgb(${p.color})`;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ============================================================
//  경기 진행 (PLAY)
// ============================================================
function startMatch() {
  const oppCode = GAME.opponents[GAME.matchIndex];
  const opp = getCountry(oppCode);
  const me  = getCountry(GAME.userCode);

  GAME.match = {
    opp, me,
    shotIndex: 0,
    saves: 0,
    conceded: 0,
    phase: "announce",  // announce|windup|flight|aftermath|done
    timer: 0,
    striker: { x: 0.5, y: 0.60, scale: 0.16, kind: "kick", side: 1, t: 0, idle: 0, celebrate: false, celebWho: "son", celebName: "", color: opp.colors.primary },
    ball: null,
    lastOutcome: "",    // 'save'|'goal'
    flash: 0, savePulse: 0,
  };
  GAME.screen = "play";
  hudEl.classList.remove("hidden");
  uiEl.innerHTML = "";
  nextShot(true);
}

function nextShot(first) {
  const m = GAME.match;
  if (!first) m.shotIndex++;
  if (m.shotIndex >= SHOTS_PER_MATCH) { endMatch(); return; }

  // 슛 종류/속도/목표 결정 (난이도 + 상대 전력 + 경기/슛 진행도)
  const L = GAME.difficulty || LEVELS[1];
  const opp = m.opp;
  const power = (opp.strength - 60) / 30;           // 0~0.8
  // 슛 종류: 헤딩/감아차기/발리/오버헤드/일반
  let kind;
  if (Math.random() < L.header) kind = "header";
  else {
    const r = Math.random();
    if (r < L.curve) kind = "curve";
    else if (r < L.curve + 0.12) kind = "volley";
    else if (r < L.curve + 0.19) kind = "overhead";
    else kind = "kick";
  }

  const g = goalRect();
  const spread = (0.45 + power * 0.4) * L.spread;   // 구석을 노리는 정도
  let fx, fy;
  if (L.legend) {
    // 레전드: 진짜 구석(특히 상단 모서리)을 정확히 노림
    const sx = Math.random() < 0.5 ? -1 : 1;
    fx = 0.5 + sx * (0.32 + Math.random() * 0.14);
    fy = (Math.random() < 0.62 ? 0.10 : 0.55) + Math.random() * 0.18;
  } else {
    fx = 0.5 + (Math.random()*2-1) * 0.5 * spread;
    fy = 0.5 + (Math.random()*2-1) * 0.45 * spread;
  }
  fx = clamp(fx, 0.05, 0.95); fy = clamp(fy, 0.07, 0.93);
  const tx = (g.x + g.w * fx) / W;
  const ty = (g.y + g.h * fy) / H;
  const side = fx > 0.5 ? 1 : -1;

  // 공 속도(상향): 난이도 배율이 핵심
  const speed = (0.58 + power * 0.32 + m.shotIndex * 0.02 + GAME.matchIndex * 0.03) * L.speedMul;

  // 감아차기 곡률(많이 꺾이게). 레전드는 일반 슛도 약간 흔들림
  let curve = 0;
  if (kind === "curve") {
    const sgn = Math.random() < 0.5 ? -1 : 1;
    curve = sgn * (0.07 + power * 0.045) * (L.legend ? 2.0 : 1.2);
  } else if (L.legend && Math.random() < 0.5) {
    curve = (Math.random()*2 - 1) * 0.05;
  }

  m.striker.kind = kind;
  m.striker.side = side;
  m.striker.x = clamp(0.5 + side * 0.12 + (Math.random()*0.1 - 0.05), 0.25, 0.75);
  m.striker.runFrom = clamp(m.striker.x - side * 0.17, 0.06, 0.94);   // 런업 시작 위치
  m.striker.celebrate = false;
  m.striker.t = 0;
  m.pending = { kind, tx, ty, speed, side, curve };
  m.phase = "announce";
  m.timer = 0;
}

function launchBall() {
  const m = GAME.match;
  const p = m.pending;
  // 공 출발: 차기=발 앞, 공중슛(헤딩/발리/오버헤드)=높은 위치
  const high = p.kind === "header" || p.kind === "overhead" || p.kind === "volley";
  const sx = m.striker.x + p.side * 0.04;
  const sy = m.striker.y - (p.kind === "overhead" ? 0.30 : high ? 0.20 : 0.02);
  m.ball = {
    sx, sy, tx: p.tx, ty: p.ty,
    z: 1, speed: p.speed, kind: p.kind, curve: p.curve || 0,
    spin: 0, mode: "flight",
  };
  m.phase = "flight";
  m.timer = 0;
}

function ballScreen(b) {
  const prog = 1 - b.z;
  const ease = prog * prog;
  let nx = b.sx + (b.tx - b.sx) * prog;
  let ny = b.sy + (b.ty - b.sy) * prog;
  if (b.curve) {                                   // 감아차기: 경로를 옆으로 휘게(바나나)
    const ddx = b.tx - b.sx, ddy = b.ty - b.sy, dl = Math.hypot(ddx, ddy) || 1;
    const k = b.curve * Math.sin(prog * Math.PI);  // 양 끝 0, 중간 최대
    nx += (-ddy / dl) * k;
    ny += ( ddx / dl) * k;
  }
  return { x: nx*W, y: ny*H, r: 9 + ease * (Math.min(W,H)*0.11), p: prog };
}

// 선방: 손에서 튕겨나가는 물리 공으로 전환 (위닝일레븐/FC 스타일 리바운드)
function resolveSave(b, s, hand) {
  const m = GAME.match;
  m.saves++;
  m.lastOutcome = "save";
  m.savePulse = 1;
  burst(s.x, s.y, "255,255,255", 16);
  burst(s.x, s.y, "74,222,128", 10);

  // 손 중심 → 공 방향 = 펀칭 방향, 위로 튀는 성향 추가
  const hx = hand.x * W, hy = hand.y * H;
  let nx = s.x - hx, ny = s.y - hy;
  const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
  ny -= 0.7;                                  // 위로
  const dd = Math.hypot(nx, ny) || 1; nx /= dd; ny /= dd;

  const powr = 520 + b.speed * 520;           // 강할수록 멀리 튕김
  b.mode = "deflect";
  b.x = s.x; b.y = s.y; b.r = s.r;
  b.vx = nx * powr + (Math.random()*2 - 1) * 140;
  b.vy = ny * powr - 160;
  b.vr = (Math.random()*2 - 1) * 0.55;
  b.bounces = 0;
  b.ground = H * 0.86;
  b.life = 2400;
}
// 실점: 공이 골 그물로 빨려들어가 바닥에 떨어짐
function resolveGoal(b, s) {
  const m = GAME.match;
  m.conceded++;
  m.lastOutcome = "goal";
  m.flash = 1;
  burst(s.x, s.y, "248,113,113", 22);

  b.mode = "goal";
  b.x = s.x; b.y = s.y; b.r = s.r;
  b.vx = (Math.random()*2 - 1) * 130;
  b.vy = 220;
  b.vr = (Math.random()*2 - 1) * 0.4;
  b.bounces = 0;
  const g = goalRect();
  b.ground = g.y + g.h - 6;
  b.life = 1400;

  // 골 그물 출렁: 공 진행 방향 + 아래로 처지게 충격
  let dx = b.tx - b.sx, dy = b.ty - b.sy;
  const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
  netImpulse(s.x, s.y, dx, dy + 0.7, 16 + b.speed * 10);

  // 랜덤 골 세리머니 (손흥민 찰칵 / 호날두 쑤이 등 12종)
  const cel = CELEBS[Math.floor(Math.random() * CELEBS.length)];
  m.striker.celebWho = cel.who;
  m.striker.celebName = cel.name;
  m.striker.celebrate = true;
}

// 튕겨나간 공의 물리 업데이트 (중력 + 바운스 + 마찰)
function updateLooseBall(b, dt) {
  const t = dt / 1000;
  b.vy += 2500 * t;                           // 중력
  b.x += b.vx * t;
  b.y += b.vy * t;
  b.spin += b.vr;
  b.life -= dt;
  if (b.y > b.ground && b.vy > 0) {           // 바닥 바운스
    b.y = b.ground;
    b.vy *= -0.55; b.vx *= 0.72; b.vr *= 0.6;
    b.bounces++;
    burst(b.x, b.ground, "255,255,255", 5);
    if (Math.abs(b.vy) < 130) b.vy = 0;       // 구르기
  }
  if (b.bounces > 0) b.r = Math.max(8, b.r - 7 * t);  // 멀어지며 축소
}

function updatePlay(dt) {
  const m = GAME.match;
  m.timer += dt;
  m.flash = Math.max(0, m.flash - dt/450);
  m.savePulse = Math.max(0, m.savePulse - dt/350);

  m.striker.idle += dt;
  updateNet();

  if (m.phase === "announce") {
    m.striker.t = 0;
    if (m.timer > 900) { m.phase = "windup"; m.timer = 0; }
  } else if (m.phase === "windup") {
    // 런업 → 백스윙 → 임팩트 (t: 0~1). 난이도 높을수록 빠르게(덜 예고)
    const wind = (GAME.difficulty || LEVELS[1]).windup || 1100;
    m.striker.t = Math.min(1, m.timer / wind);
    if (m.timer > wind) { launchBall(); }
  } else if (m.phase === "flight") {
    const b = m.ball;
    // 공격수 팔로스루
    m.striker.t = 1 + Math.min(0.4, m.timer / 900);

    if (b.mode === "flight") {
      b.z -= b.speed * (dt/1000);
      b.spin += dt * (b.curve ? 0.05 : 0.02);   // 감아차기는 회전 많이
      const s = ballScreen(b);
      // 손 충돌 (공이 충분히 가까워졌을 때) → 선방(리바운드)
      if (s.p > 0.5) {
        const minWH = Math.min(W, H);
        for (const h of hands) {
          const hx = h.x*W, hy = h.y*H, hr = h.r*minWH;
          if (Math.hypot(hx - s.x, hy - s.y) < hr + s.r*0.8) { resolveSave(b, s, h); break; }
        }
      }
      // 골라인 도달 → 실점
      if (b.mode === "flight" && b.z <= 0) { resolveGoal(b, ballScreen(b)); }
    } else {
      // 튕겨나가는 중 — 물리
      updateLooseBall(b, dt);
      if (b.life <= 0 || b.x < -80 || b.x > W + 80 || b.y > H + 100) { m.phase = "aftermath"; m.timer = 0; }
    }
  } else if (m.phase === "aftermath") {
    // 골이면 세리머니/그물 출렁임을 더 보여줌
    if (m.timer > (m.lastOutcome === "goal" ? 1500 : 800)) { nextShot(false); }
  }

  updateParticles(dt);
  updateHud();
}

function renderPlay() {
  const m = GAME.match;
  drawStadium();

  // 공격수
  drawStriker(m.striker);

  // 지면슛(일반/감아차기)일 때만, 차기 직전 발 앞에 놓인 공
  if (m.phase === "windup" && (m.pending.kind === "kick" || m.pending.kind === "curve")) {
    const t = seg(m.striker.t, 0.5, 1);
    const bx = (m.striker.x + m.pending.side * 0.05) * W;
    const by = (m.striker.y - 0.005) * H;
    drawSoccerBall(bx, by, Math.min(W,H) * 0.018, m.striker.t * 6, 1 - t*0.3);
  }

  // 공
  if (m.ball) {
    if (m.ball.mode === "flight") { if (m.phase === "flight") drawBall(m.ball); }
    else if (m.phase === "flight" || m.phase === "aftermath") drawLooseBall(m.ball);
  }

  // 장갑
  drawGloves(m.me.colors.glove);
  drawParticles();

  // 슛 예고 (슛 종류 표기)
  if (m.phase === "announce") {
    const KIND = { kick:"슈팅", curve:"감아차기", volley:"발리슛", overhead:"오버헤드킥", header:"헤딩" };
    banner(`${m.opp.flag} ${m.opp.name} ${KIND[m.pending.kind] || "슈팅"} 준비!`,
           `${m.shotIndex + 1} / ${SHOTS_PER_MATCH}`);
  }
  // 결과 텍스트 (리바운드/실점 연출 동안 계속 표시)
  if ((m.phase === "flight" && m.ball && m.ball.mode !== "flight") || m.phase === "aftermath") {
    if (m.lastOutcome === "save") bigText("SAVE! 🧤", "#4ade80");
    else if (m.lastOutcome === "goal") bigText("GOAL...", "#f87171");
  }

  // 손 미인식 안내
  if (hands.length === 0 && (m.phase === "windup" || m.phase === "flight")) {
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.font = `bold ${Math.round(W*0.018)}px 'Segoe UI', sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("✋ 양손이 카메라에 보이게 하세요", W/2, H*0.88);
  }

  // 이펙트 오버레이
  if (m.flash > 0) { ctx.fillStyle = `rgba(248,113,113,${m.flash*0.4})`; ctx.fillRect(0,0,W,H); }
  if (m.savePulse > 0) { ctx.strokeStyle = `rgba(74,222,128,${m.savePulse})`; ctx.lineWidth = 16; ctx.strokeRect(8,8,W-16,H-16); }
}

// 단풍잎(캐나다 모티프) 단순 폴리곤
const MAPLE = [[0,-1],[0.16,-0.45],[0.55,-0.6],[0.42,-0.18],[0.78,-0.05],[0.36,0.16],
  [0.6,0.5],[0.18,0.45],[0,1],[-0.18,0.45],[-0.6,0.5],[-0.36,0.16],
  [-0.78,-0.05],[-0.42,-0.18],[-0.55,-0.6],[-0.16,-0.45]];
function drawMaple(sz, col) {
  ctx.fillStyle = col;
  ctx.beginPath();
  MAPLE.forEach((p, i) => { const px = p[0]*sz, py = p[1]*sz; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
  ctx.closePath(); ctx.fill();
}

// 축구공 = 2026 월드컵 공인구 "아디다스 Trionda" 재현
// 흰색 베이스 · 중앙 삼각형에서 뻗는 3개 웨이브(캐나다 적/멕시코 녹/미국 청) · 금색 라인 · 단풍잎·별
function drawSoccerBall(x, y, r, spin, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha == null ? 1 : alpha;

  // 흰색 베이스 + 구체 음영
  const g = ctx.createRadialGradient(x-r*0.35, y-r*0.35, r*0.1, x, y, r);
  g.addColorStop(0, "#ffffff"); g.addColorStop(0.72, "#f1f4f8"); g.addColorStop(1, "#c2ccd6");
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();

  // 패턴(공 안쪽으로 클립)
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.clip();
  ctx.translate(x, y); ctx.rotate(spin);

  const RED = "#d52b1e", GREEN = "#0a7a45", BLUE = "#1d4ed8", GOLD = "#d4af37";
  const TAU = Math.PI*2;
  const zones = [
    { a: -Math.PI/2,            col: RED,   sym: "maple" },  // 캐나다
    { a: -Math.PI/2 + TAU/3,    col: GREEN, sym: "dot"   },  // 멕시코(독수리→점)
    { a: -Math.PI/2 + 2*TAU/3,  col: BLUE,  sym: "star"  },  // 미국
  ];
  const ir = r*0.11, tip = r*1.18, hw = 0.66;
  for (const z of zones) {
    const a = z.a;
    ctx.fillStyle = z.col;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a-hw)*ir, Math.sin(a-hw)*ir);
    ctx.quadraticCurveTo(Math.cos(a-hw*0.55)*tip, Math.sin(a-hw*0.55)*tip, Math.cos(a)*tip, Math.sin(a)*tip);
    ctx.quadraticCurveTo(Math.cos(a+hw*0.55)*tip, Math.sin(a+hw*0.55)*tip, Math.cos(a+hw)*ir, Math.sin(a+hw)*ir);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = GOLD; ctx.lineWidth = Math.max(1, r*0.045); ctx.lineJoin = "round"; ctx.stroke();
  }
  // 중앙 삼각형(금색 테두리)
  ctx.fillStyle = "#ffffff"; ctx.strokeStyle = GOLD; ctx.lineWidth = Math.max(1, r*0.05);
  ctx.beginPath();
  for (let i = 0; i < 3; i++) { const a = -Math.PI/2 + i*TAU/3; const px = Math.cos(a)*r*0.15, py = Math.sin(a)*r*0.15; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // 모티프 심볼 (충분히 클 때)
  if (r > 15) {
    for (const z of zones) {
      const a = z.a, rad = r*0.62, sz = r*0.17;
      ctx.save();
      ctx.translate(Math.cos(a)*rad, Math.sin(a)*rad);
      ctx.rotate(a + Math.PI/2);
      if (z.sym === "maple") drawMaple(sz, "#ffffff");
      else if (z.sym === "star") { ctx.fillStyle = "#ffffff"; ctx.beginPath(); star(0, 0, sz, 5); ctx.fill(); }
      else { ctx.fillStyle = "#f3c94b"; ctx.beginPath(); ctx.arc(0, 0, sz*0.55, 0, Math.PI*2); ctx.fill(); }
      ctx.restore();
    }
  }
  ctx.restore(); // 클립 해제

  // 림 외곽선 + 광택
  ctx.strokeStyle = "rgba(0,0,0,0.22)"; ctx.lineWidth = Math.max(1.5, r*0.06);
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath(); ctx.ellipse(x-r*0.32, y-r*0.4, r*0.22, r*0.12, -0.6, 0, Math.PI*2); ctx.fill();

  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawBall(b) {
  const { x, y, r } = ballScreen(b);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(x, y + r*0.9, r*0.9, r*0.3, 0, 0, Math.PI*2); ctx.fill();
  drawSoccerBall(x, y, r, b.spin);
}

// 튕겨나가는 공 (지면 그림자 = 공중 높이에 따라 분리)
function drawLooseBall(b) {
  const gap = Math.max(0, b.ground - b.y);
  const ssc = clamp(1 - gap / (H*0.4), 0.35, 1);
  ctx.fillStyle = `rgba(0,0,0,${0.28*ssc})`;
  ctx.beginPath(); ctx.ellipse(b.x, b.ground + 2, b.r*0.95*ssc, b.r*0.32*ssc, 0, 0, Math.PI*2); ctx.fill();
  drawSoccerBall(b.x, b.y, b.r, b.spin);
}

function banner(line1, line2) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(0, H*0.40, W, H*0.16);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(W*0.030)}px 'Segoe UI', sans-serif`;
  ctx.fillText(line1, W/2, H*0.475);
  ctx.fillStyle = "#fbbf24";
  ctx.font = `bold ${Math.round(W*0.022)}px 'Segoe UI', sans-serif`;
  ctx.fillText(line2, W/2, H*0.525);
  ctx.restore();
}
function bigText(t, color) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.font = `900 ${Math.round(W*0.06)}px 'Segoe UI', sans-serif`;
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 18;
  ctx.fillText(t, W/2, H*0.45);
  ctx.restore();
}

function updateHud() {
  const m = GAME.match;
  hudMatch.textContent = `${m.me.flag} ${m.me.name}  vs  ${m.opp.name} ${m.opp.flag}`;
  hudScore.textContent = `실점 ${m.conceded}  ·  선방 ${m.saves}`;
  hudShots.textContent = `슛 ${Math.min(m.shotIndex + (m.phase==="aftermath"?1:0), SHOTS_PER_MATCH)}/${SHOTS_PER_MATCH}`;
  const n = hands.length;
  hudHands.textContent = n >= 2 ? "✋✋ 양손 인식" : n === 1 ? "✋ 한 손 인식" : "⚠ 손 인식 대기";
  hudHands.style.color = n >= 2 ? "#4ade80" : n === 1 ? "#fbbf24" : "#f87171";
}

// ============================================================
//  경기 종료 → 결과 산출 + 다른 조 경기 시뮬레이션
// ============================================================
function endMatch() {
  const m = GAME.match;
  const me = m.me, opp = m.opp;

  // 실점 = 막지 못한 슛
  const ga = m.conceded;
  // 내 팀 득점: 전력차 + 선방 보너스 + 약간의 운
  const diff = (me.strength - opp.strength) / 20;
  let gf = Math.round(1 + diff + m.saves * 0.22 + (Math.random()*1.0 - 0.35));
  gf = Math.max(0, Math.min(5, gf));

  applyResult(me.code, opp.code, gf, ga);

  // 같은 매치데이의 '다른 경기' (나와 무관한 두 팀) 시뮬레이션
  const others = GAME.opponents.filter((_, i) => i !== GAME.matchIndex);
  // 매치데이별로 남은 두 팀이 맞붙도록 구성
  const pair = otherPairForMatchday(GAME.matchIndex);
  const sim = simulateMatch(pair[0], pair[1]);
  applyResult(pair[0], pair[1], sim[0], sim[1]);

  GAME.lastResults = [
    { a: me.code, b: opp.code, ga_: gf, gb_: ga, you: true },
    { a: pair[0], b: pair[1], ga_: sim[0], gb_: sim[1], you: false },
  ];

  GAME.userMatchScore = { gf, ga };
  showMatchResult();
}

// 매치데이 i 에서 '내가 아닌 두 팀'의 대진
function otherPairForMatchday(i) {
  const o = GAME.opponents; // [A,B,C], 내 상대 순서
  // MD0: 나-A, B-C / MD1: 나-B, A-C / MD2: 나-C, A-B
  if (i === 0) return [o[1], o[2]];
  if (i === 1) return [o[0], o[2]];
  return [o[0], o[1]];
}

function simulateMatch(codeA, codeB) {
  const a = getCountry(codeA), b = getCountry(codeB);
  const ea = 1.1 + (a.strength - b.strength) / 22;
  const eb = 1.1 + (b.strength - a.strength) / 22;
  return [poisson(Math.max(0.2, ea)), poisson(Math.max(0.2, eb))];
}
function poisson(lambda) {
  // Knuth 알고리즘
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return Math.min(6, k - 1);
}

function applyResult(codeA, codeB, ga_, gb_) {
  const A = GAME.table[codeA], B = GAME.table[codeB];
  A.pld++; B.pld++;
  A.gf += ga_; A.ga += gb_; B.gf += gb_; B.ga += ga_;
  if (ga_ > gb_) { A.pts += 3; A.w++; B.l++; }
  else if (ga_ < gb_) { B.pts += 3; B.w++; A.l++; }
  else { A.pts++; B.pts++; A.d++; B.d++; }
}

// ============================================================
//  화면들 (HTML 오버레이)
// ============================================================
function show(html) { uiEl.innerHTML = html; uiEl.classList.remove("hidden"); }
function hideUI() { uiEl.innerHTML = ""; }

function showBoot() {
  GAME.screen = "boot";
  hudEl.classList.add("hidden");
  show(`
    <div class="panel">
      <div class="cup">🏆</div>
      <h1>월드컵 핸드 골키퍼</h1>
      <p class="subtitle">2026 월드컵 <b>A조</b> · 웹캠으로 <b>양손</b>을 움직여 슛을 막는 골키퍼 게임</p>
      <ol class="howto">
        <li><b>카메라 권한</b>을 허용하세요. (손 추적 전용 — 내 모습은 화면에 안 나옵니다)</li>
        <li>플레이할 <b>국가</b>와 <b>골키퍼</b>를 고릅니다.</li>
        <li>조별리그 <b>3경기</b>에서 상대의 슛·헤딩을 손으로 막아내세요.</li>
        <li>최종 순위로 <b>32강 진출국</b>이 결정됩니다!</li>
      </ol>
      <button id="bootBtn">카메라 시작 ▶</button>
      <p id="status" class="status"></p>
      <p class="src">골키퍼 정보 출처: Wikipedia · FIFA · 각국 협회 (2025-26 기준)</p>
    </div>`);
  document.getElementById("bootBtn").onclick = async (e) => {
    const btn = e.target, st = document.getElementById("status");
    btn.disabled = true; st.textContent = "손 추적 모델을 불러오는 중...";
    audioInit();   // 사용자 제스처에서 오디오 활성화
    try { await initTracking(); st.textContent = ""; showDifficultySelect(); }
    catch (err) {
      st.classList.add("error");
      st.textContent = "카메라를 시작할 수 없어요: " + (err?.message || err) +
        " — 권한 허용과 http://localhost 실행을 확인하세요.";
      btn.disabled = false;
    }
  };
}

function showDifficultySelect() {
  GAME.screen = "difficulty";
  hudEl.classList.add("hidden");
  const cards = LEVELS.map((L, i) => `
    <button class="card level" data-i="${i}" style="--accent:#22d3ee">
      <div class="flag">${L.emoji}</div>
      <div class="cname">${L.label}</div>
      <div class="knote">${L.desc}</div>
      <div class="cstr">공 속도 ×${L.speedMul.toFixed(2)}</div>
    </button>`).join("");
  show(`
    <div class="panel wide">
      <h2>난이도를 선택하세요</h2>
      <p class="subtitle">레벨이 높을수록 <b>빠르고</b> 구석으로 · <b>발리·오버헤드·감아차기</b>까지 날아옵니다</p>
      <div class="grid-levels">${cards}</div>
    </div>`);
  uiEl.querySelectorAll(".level").forEach(b =>
    b.onclick = () => { GAME.difficulty = LEVELS[+b.dataset.i]; showCountrySelect(); });
}

function showCountrySelect() {
  GAME.screen = "country";
  hudEl.classList.add("hidden");
  initTable();
  const cards = COUNTRIES.map(c => `
    <button class="card country" data-code="${c.code}" style="--accent:${c.colors.primary}">
      <div class="flag">${c.flag}</div>
      <div class="cname">${c.name}</div>
      <div class="cen">${c.nameEn}</div>
      <div class="cstr">전력 ${c.strength}</div>
    </button>`).join("");
  const L = GAME.difficulty || LEVELS[1];
  show(`
    <div class="panel wide">
      <h2>플레이할 국가를 선택하세요</h2>
      <p class="subtitle">2026 월드컵 A조 — 당신은 이 나라의 <b>골키퍼</b>가 됩니다 · 난이도 <b>${L.emoji} ${L.label}</b></p>
      <div class="grid4">${cards}</div>
      <button class="back" id="diffBackBtn">← 난이도 다시 선택</button>
    </div>`);
  uiEl.querySelectorAll(".country").forEach(b =>
    b.onclick = () => { GAME.userCode = b.dataset.code; showKeeperSelect(); });
  document.getElementById("diffBackBtn").onclick = showDifficultySelect;
}

function avatar(k, country) {
  if (k.photo) {
    return `<img class="ph" src="${k.photo}" alt="${k.name}"
      onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph ph-fallback',style:'background:${country.colors.primary}',textContent:'${k.name[0]}'}))">`;
  }
  return `<div class="ph ph-fallback" style="background:${country.colors.primary}">${k.name[0]}</div>`;
}

function showKeeperSelect() {
  GAME.screen = "keeper";
  const c = getCountry(GAME.userCode);
  const cards = c.keepers.map((k, i) => `
    <button class="card keeper" data-i="${i}">
      ${k.starter ? '<div class="badge">주전</div>' : ''}
      ${avatar(k, c)}
      <div class="kname">${k.name}</div>
      <div class="ksub">${k.sub}</div>
      <div class="kmeta">${k.age}세 · ${k.club}</div>
      <div class="kmeta caps">A매치 ${k.caps}경기</div>
      <div class="knote">${k.note}</div>
    </button>`).join("");
  show(`
    <div class="panel wide">
      <h2>${c.flag} ${c.name} · 골키퍼 선택</h2>
      <p class="subtitle">실제 ${c.name} 대표팀 주전급 골키퍼 3인 (2025-26 기준)</p>
      <div class="grid3">${cards}</div>
      <button class="back" id="backBtn">← 국가 다시 선택</button>
    </div>`);
  uiEl.querySelectorAll(".keeper").forEach(b =>
    b.onclick = () => {
      GAME.keeper = c.keepers[+b.dataset.i];
      // 상대 3개국 순서(전력 약→강이면 난이도 상승)
      GAME.opponents = COUNTRIES.filter(x => x.code !== GAME.userCode)
        .sort((a, z) => a.strength - z.strength).map(x => x.code);
      GAME.matchIndex = 0;
      showMatchIntro();
    });
  document.getElementById("backBtn").onclick = showCountrySelect;
}

function showMatchIntro() {
  GAME.screen = "intro";
  hudEl.classList.add("hidden");
  const me = getCountry(GAME.userCode), opp = getCountry(GAME.opponents[GAME.matchIndex]);
  const k = GAME.keeper;
  show(`
    <div class="panel">
      <div class="md">A조 ${GAME.matchIndex + 1}차전</div>
      <div class="vs">
        <div class="vs-side"><div class="vflag">${me.flag}</div><div>${me.name}</div>
          <div class="vk">${avatarMini(k, me)} <span>${k.name}</span></div></div>
        <div class="vs-x">VS</div>
        <div class="vs-side"><div class="vflag">${opp.flag}</div><div>${opp.name}</div>
          <div class="vk dim">상대 공격</div></div>
      </div>
      <p class="subtitle">${SHOTS_PER_MATCH}개의 슛을 막아내세요. 양손을 모두 활용!</p>
      <button id="kickoff">킥오프 ▶</button>
    </div>`);
  document.getElementById("kickoff").onclick = startMatch;
}
function avatarMini(k, c) {
  return k.photo
    ? `<img class="mini" src="${k.photo}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mini mini-fb',style:'background:${c.colors.primary}',textContent:'${k.name[0]}'}))">`
    : `<span class="mini mini-fb" style="background:${c.colors.primary}">${k.name[0]}</span>`;
}

function resultLine(r) {
  const a = getCountry(r.a), b = getCountry(r.b);
  const win = r.ga_ === r.gb_ ? "" : (r.ga_ > r.gb_ ? "a" : "b");
  return `<div class="rline ${r.you ? 'you' : ''}">
      <span class="rt ${win==='a'?'w':''}">${a.flag} ${a.name}</span>
      <span class="rs">${r.ga_} : ${r.gb_}</span>
      <span class="rt ${win==='b'?'w':''}">${b.name} ${b.flag}</span>
      ${r.you ? '<span class="mine">내 경기</span>' : ''}
    </div>`;
}

function showMatchResult() {
  GAME.screen = "matchresult";
  hudEl.classList.add("hidden");
  const m = GAME.match;
  const { gf, ga } = GAME.userMatchScore;
  const verdict = gf > ga ? ["승리! 🎉", "#4ade80"] : gf < ga ? ["패배", "#f87171"] : ["무승부", "#fbbf24"];
  const lines = GAME.lastResults.map(resultLine).join("");
  show(`
    <div class="panel wide">
      <h2 style="color:${verdict[1]}">${verdict[0]}</h2>
      <div class="bigscore">${m.me.flag} ${gf} : ${ga} ${m.opp.flag}</div>
      <p class="subtitle">선방 ${m.saves} · 실점 ${m.conceded} (슛 ${SHOTS_PER_MATCH}개 중)</p>
      <h3 class="sec">A조 ${GAME.matchIndex + 1}차전 경기 결과</h3>
      <div class="results">${lines}</div>
      ${miniTable()}
      <button id="nextBtn">${GAME.matchIndex < 2 ? "다음 경기 ▶" : "최종 결과 보기 🏁"}</button>
    </div>`);
  document.getElementById("nextBtn").onclick = () => {
    if (GAME.matchIndex < 2) { GAME.matchIndex++; showMatchIntro(); }
    else showFinal();
  };
}

function sortedTable() {
  return Object.entries(GAME.table)
    .map(([code, t]) => ({ code, ...t, gd: t.gf - t.ga }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
}
function miniTable() {
  const rows = sortedTable().map((t, i) => {
    const c = getCountry(t.code);
    const adv = i < 2 ? "adv" : "";
    return `<tr class="${adv} ${t.code===GAME.userCode?'me':''}">
      <td>${i+1}</td><td class="tn">${c.flag} ${c.name}</td>
      <td>${t.pld}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
      <td>${t.gf}:${t.ga}</td><td class="gd">${t.gd>=0?'+':''}${t.gd}</td><td class="pt">${t.pts}</td></tr>`;
  }).join("");
  return `<table class="table">
    <thead><tr><th>#</th><th>팀</th><th>경기</th><th>승</th><th>무</th><th>패</th><th>득실</th><th>차</th><th>승점</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="legend"><span class="dot adv"></span> 32강 진출권 (조 1·2위)</p>`;
}

function showFinal() {
  GAME.screen = "final";
  hudEl.classList.add("hidden");
  const table = sortedTable();
  const userRank = table.findIndex(t => t.code === GAME.userCode) + 1;

  // 순위별 엔딩 컷신
  if (userRank === 1) startBeerScene(table);        // 1위: 심판이 치킨(Drumstick chicken.glb)
  else if (userRank === 2) startHighFiveScene(table); // 2위: 동료 3명과 하이파이브
  else if (userRank === 3) startPetScene(table);    // 3위: 강아지 쓰담쓰담
  else startPoliceScene(table);                     // 4위: 경찰차 + 경찰관 2명
}

// ============================================================
//  탈락 컷신: 경찰 체포 (두 손 보이게 → 수갑)
// ============================================================
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
}
function star(cx, cy, r, n) {
  for (let i = 0; i < n*2; i++) {
    const rr = i % 2 ? r*0.45 : r;
    const a = -Math.PI/2 + i*Math.PI/n;
    const x = cx + Math.cos(a)*rr, y = cy + Math.sin(a)*rr;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function speechBubble(cx, baseY, text) {
  ctx.save();
  ctx.font = `bold ${Math.round(W*0.024)}px 'Segoe UI', 'Malgun Gothic', sans-serif`;
  const padX = W*0.020, padY = H*0.020;
  const tw = ctx.measureText(text).width;
  const bw = tw + padX*2, bh = Math.round(W*0.024) + padY*2;
  const x = cx - bw/2, y = baseY - bh - 18;
  ctx.fillStyle = "rgba(255,255,255,0.97)";
  ctx.strokeStyle = "#1b2a4a"; ctx.lineWidth = 3;
  roundRect(x, y, bw, bh, 14); ctx.fill(); ctx.stroke();
  // 꼬리
  ctx.beginPath();
  ctx.moveTo(cx-12, y+bh-1); ctx.lineTo(cx+12, y+bh-1); ctx.lineTo(cx, y+bh+18); ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.97)"; ctx.fill();
  ctx.strokeStyle = "#1b2a4a"; ctx.beginPath();
  ctx.moveTo(cx-12, y+bh-1); ctx.lineTo(cx, y+bh+18); ctx.lineTo(cx+12, y+bh-1); ctx.stroke();
  ctx.fillStyle = "#11151f"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, cx, y+bh/2);
  ctx.restore();
}

function drawCop(a) {
  const s = a.scale * Math.min(W, H);
  ctx.save();
  ctx.translate(a.x*W, a.y*H);
  const navy = "#1b2a4a", navyD = "#101b33", cap = "#0e1830", skin = "#e0b48c", gold = "#fbbf24", black = "#0b0f1a";

  // 그림자
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.26, s*0.06, 0, 0, Math.PI*2); ctx.fill();

  // 다리 (걷기)
  const sw = Math.sin(a.walk || 0) * 0.10 * s;
  ctx.strokeStyle = black; ctx.lineCap = "round"; ctx.lineWidth = s*0.10;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.30); ctx.lineTo(-s*0.06 + sw, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.06, -s*0.30); ctx.lineTo(s*0.06 - sw, 0); ctx.stroke();

  // 몸통(제복)
  ctx.fillStyle = navy; ctx.strokeStyle = navyD; ctx.lineWidth = s*0.02;
  roundRect(-s*0.16, -s*0.60, s*0.32, s*0.32, s*0.06); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -s*0.58); ctx.lineTo(0, -s*0.30); ctx.stroke();   // 단추선
  // 벨트
  ctx.fillStyle = black; ctx.fillRect(-s*0.16, -s*0.33, s*0.32, s*0.05);
  ctx.fillStyle = gold; ctx.fillRect(-s*0.03, -s*0.335, s*0.06, s*0.05);
  // 가슴 배지
  ctx.fillStyle = gold; ctx.beginPath(); star(-s*0.09, -s*0.50, s*0.042, 5); ctx.fill();

  // 팔 (reach=앞으로, point=손가락질)
  const reach = a.armReach || 0, point = a.point || 0;
  const shY = -s*0.52;
  ctx.strokeStyle = navy; ctx.lineWidth = s*0.085; ctx.lineCap = "round";
  const lx = -s*(0.14 + reach*0.20), ly = shY + (point ? -s*0.20 : reach ? -s*0.12 : s*0.02);
  const rx =  s*(0.14 + reach*0.20), ry = shY + (reach ? -s*0.12 : s*0.02);
  ctx.beginPath(); ctx.moveTo(-s*0.11, shY); ctx.lineTo(lx, ly); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.11, shY); ctx.lineTo(rx, ry); ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(lx, ly, s*0.05, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(rx, ry, s*0.05, 0, Math.PI*2); ctx.fill();

  // 머리 + 경찰모
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -s*0.70, s*0.11, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = cap;
  ctx.beginPath(); ctx.ellipse(0, -s*0.78, s*0.15, s*0.05, 0, 0, Math.PI*2); ctx.fill();   // 챙
  roundRect(-s*0.11, -s*0.90, s*0.22, s*0.11, s*0.03); ctx.fill();
  ctx.fillStyle = gold; ctx.beginPath(); star(0, -s*0.845, s*0.028, 5); ctx.fill();         // 모표

  ctx.restore();
}

// 추적된 양손(손목)에 수갑 + 체인
function drawCuffs(t) {
  if (!hands.length) return;
  const minWH = Math.min(W, H);
  const wr = hands.map(h => { const w = h.landmarks[0]; return [(1-w.x)*W, w.y*H, h.r*minWH]; });

  if (wr.length >= 2) {   // 두 손목 사이 체인
    const [a, b] = wr; const links = 7;
    ctx.strokeStyle = "#9aa3ad"; ctx.lineWidth = Math.max(3, a[2]*0.12); ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i <= links; i++) {
      const x = lerp(a[0],b[0],i/links), y = lerp(a[1],b[1],i/links) + Math.sin(i/links*Math.PI)*10;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = "#c4ccd4";
    for (let i = 0; i <= links; i++) {
      const x = lerp(a[0],b[0],i/links), y = lerp(a[1],b[1],i/links) + Math.sin(i/links*Math.PI)*10;
      ctx.beginPath(); ctx.arc(x, y, a[2]*0.06, 0, Math.PI*2); ctx.fill();
    }
  }
  for (const [x, y, r] of wr) {     // 손목 수갑 링
    const rr = r * 0.52 * Math.min(1, t*1.2);
    ctx.strokeStyle = "#c4ccd4"; ctx.lineWidth = r*0.24;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI*2); ctx.stroke();
    ctx.strokeStyle = "#7c8694"; ctx.lineWidth = r*0.10;
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI*2); ctx.stroke();
    ctx.fillStyle = "#5b6571"; ctx.fillRect(x - r*0.12, y + rr - r*0.05, r*0.24, r*0.16);   // 잠금
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = r*0.05;
    ctx.beginPath(); ctx.arc(x, y, rr, -Math.PI*0.85, -Math.PI*0.4); ctx.stroke();
  }
}

function startArrestScene(table, userRank) {
  GAME.screen = "arrest";
  hudEl.classList.add("hidden");
  uiEl.innerHTML = "";
  GAME.arrest = { phase: "approach", timer: 0, copX: -0.22, walk: 0, cuffT: 0, panelShown: false, table, userRank };
}

function updateArrest(dt) {
  const A = GAME.arrest; A.timer += dt;
  if (A.phase === "approach") {
    A.walk += dt * 0.02;
    A.copX = lerp(-0.22, 0.32, Math.min(1, A.timer/1700));
    if (A.timer >= 1700) { A.phase = "command"; A.timer = 0; }
  } else if (A.phase === "command") {
    // 양손을 보일 때까지 (최대 4.5초면 강제 진행)
    if ((hands.length >= 2 && A.timer > 1400) || A.timer > 4500) { A.phase = "cuff"; A.timer = 0; }
  } else if (A.phase === "cuff") {
    A.cuffT = Math.min(1, A.timer/1300);
    if (A.timer > 1600) { A.phase = "done"; A.timer = 0; }
  } else if (A.phase === "done") {
    A.cuffT = 1;
    if (!A.panelShown && A.timer > 700) { A.panelShown = true; showArrestPanel(); }
  }
  updateParticles(dt);
}

function renderArrest(dt) {
  const A = GAME.arrest;
  drawStadium();
  // 경광등(적·청 점멸)
  const sir = Math.sin(A.timer * 0.012);
  const col = sir > 0 ? "239,68,68" : "59,130,246";
  ctx.fillStyle = `rgba(${col},${0.10 + 0.07*Math.abs(sir)})`;
  ctx.fillRect(0, 0, W, H*0.5);

  drawCop({
    x: A.copX, y: 0.74, scale: 0.30, walk: A.walk,
    armReach: (A.phase === "cuff" || A.phase === "done") ? 1 : 0,
    point: A.phase === "command" ? 1 : 0,
  });

  if (GAME.tracking) drawGloves(getCountry(GAME.userCode).colors.glove);
  if (A.phase === "cuff" || A.phase === "done") drawCuffs(A.cuffT);
  drawParticles();

  // 말풍선 대사
  let line = null;
  if (A.phase === "approach")      line = "…거기 골키퍼! 움직이지 마!";
  else if (A.phase === "command")  line = hands.length >= 2 ? "좋아, 그대로 있어!" : "두 손을 보이게 하세요!";
  else if (A.phase === "cuff")     line = "당신을 체포합니다! 🔗";
  if (line) {
    const cx = clamp(A.copX*W, W*0.20, W*0.80);
    speechBubble(cx, 0.74*H - 0.30*Math.min(W,H)*0.92, line);
  }
  // 손 안 보이면 안내
  if (A.phase === "command" && hands.length < 2) {
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(W*0.018)}px 'Segoe UI', sans-serif`;
    ctx.fillText("✋✋ 양손을 카메라에 보이세요", W/2, H*0.92);
  }
}

function showArrestPanel() {
  const A = GAME.arrest;
  const me = getCountry(GAME.userCode);
  show(`
    <div class="panel wide">
      <div class="cup">🚔</div>
      <h1 style="color:#f87171">체포되었습니다</h1>
      <p class="subtitle">${me.flag} ${me.name} — 조 <b>${A.userRank}위</b>로 <b>32강 탈락</b><br>
        <span style="color:#cbd5e1">"두 손을 보이게 하세요… 철컹! 🔗"</span></p>
      ${miniTable()}
      <button id="againBtn">처음부터 다시 ↻ (난이도 선택)</button>
    </div>`);
  document.getElementById("againBtn").onclick = () => { GAME.arrest = null; showDifficultySelect(); };
}

// ============================================================
//  조 1위 컷신: 심판이 하이네켄 맥주를 건네고 골키퍼가 마심
// ============================================================
function drawRef(a) {
  const s = a.scale * Math.min(W, H);
  ctx.save();
  ctx.translate(a.x*W, a.y*H);
  const black = "#1a1d24", blackD = "#0c0e13", skin = "#e0b48c";
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.24, s*0.055, 0, 0, Math.PI*2); ctx.fill();
  const sw = Math.sin(a.walk || 0) * 0.10 * s;
  ctx.strokeStyle = "#0b0f1a"; ctx.lineCap = "round"; ctx.lineWidth = s*0.10;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.30); ctx.lineTo(-s*0.06 + sw, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.06, -s*0.30); ctx.lineTo(s*0.06 - sw, 0); ctx.stroke();
  ctx.fillStyle = black; ctx.strokeStyle = blackD; ctx.lineWidth = s*0.02;
  roundRect(-s*0.16, -s*0.60, s*0.32, s*0.32, s*0.06); ctx.fill(); ctx.stroke();
  // 노란 카라(심판복 느낌)
  ctx.fillStyle = "#fbbf24"; ctx.fillRect(-s*0.16, -s*0.60, s*0.32, s*0.03);
  // 팔: 한 팔로 병 건넴(앞으로)
  ctx.strokeStyle = black; ctx.lineWidth = s*0.085; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(s*0.11, -s*0.52); ctx.lineTo(s*0.34, -s*0.42); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-s*0.11, -s*0.52); ctx.lineTo(-s*0.16, -s*0.34); ctx.stroke();
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(s*0.34, -s*0.42, s*0.05, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(-s*0.16, -s*0.34, s*0.05, 0, Math.PI*2); ctx.fill();
  // 머리 + 머리카락
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -s*0.70, s*0.11, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#1a1410"; ctx.beginPath(); ctx.arc(0, -s*0.72, s*0.11, Math.PI*1.05, Math.PI*2.05); ctx.fill();
  ctx.restore();
}

// 하이네켄 병 (초록 병 · 빨간 별 · 라벨)
function drawBottle(x, y, sc, tilt) {
  ctx.save();
  ctx.translate(x, y); ctx.rotate(tilt);
  const h = sc, w = sc*0.34, green = "#0a6b2e", greenD = "#064d20";
  ctx.fillStyle = green; ctx.strokeStyle = greenD; ctx.lineWidth = sc*0.02;
  roundRect(-w/2, -h*0.5, w, h*0.72, w*0.25); ctx.fill(); ctx.stroke();   // 몸통
  ctx.fillStyle = green; ctx.fillRect(-w*0.18, -h*0.72, w*0.36, h*0.24);   // 목
  ctx.fillStyle = "#c0392b"; ctx.fillRect(-w*0.20, -h*0.80, w*0.40, h*0.09); // 캡
  ctx.fillStyle = "#f3f4f6"; roundRect(-w*0.42, -h*0.18, w*0.84, h*0.34, w*0.06); ctx.fill(); // 라벨
  ctx.fillStyle = "#e2231a"; ctx.beginPath(); star(0, -h*0.04, w*0.15, 5); ctx.fill();        // 빨간 별
  ctx.fillStyle = "#0a6b2e"; ctx.textAlign = "center";
  ctx.font = `bold ${Math.round(w*0.30)}px 'Segoe UI', sans-serif`;
  ctx.fillText("Heineken", 0, h*0.11);
  ctx.restore();
}

const CHICKEN_BITES = 4;
function startBeerScene(table) {
  GAME.screen = "beer";
  hudEl.classList.add("hidden");
  uiEl.innerHTML = "";
  threeBegin();
  GAME.beer = { phase: "approach", timer: 0, refX: 1.2, walk: 0, panelShown: false, table,
                beer: null, loaded: false, baseY: 0, baseScale: 1,
                bites: CHICKEN_BITES, bitesLeft: CHICKEN_BITES, biteCool: 0, chompT: 0, lastHands: {} };
  three.camera.position.set(0, 0.05, 2.6); three.camera.lookAt(0, 0, 0); three.camera.updateProjectionMatrix();
  loadGLB("Drumstick chicken.glb").then(g => {
    const b = g.scene, f = fitModel(b, 1.25);
    b.scale.setScalar(f.s);
    b.position.set(-f.center.x*f.s, -f.center.y*f.s - 0.05, -f.center.z*f.s);   // 화면 중앙
    b.rotation.set(0, 0, 0);
    three.content.add(b);
    GAME.beer.beer = b; GAME.beer.baseY = b.position.y; GAME.beer.baseScale = f.s; GAME.beer.loaded = true;
  }).catch(() => {});
}
// 치킨 화면 좌표/히트영역(남은 조각에 따라 작아짐)
function chickenHit(A) {
  const frac = A.bitesLeft / A.bites;
  return { x: W*0.5, y: H*0.46, r: Math.min(W,H)*0.17*(0.4 + 0.6*frac) };
}
function updateBeer(dt) {
  const A = GAME.beer; A.timer += dt;
  if (A.biteCool > 0) A.biteCool -= dt;
  if (A.chompT > 0) A.chompT -= dt;
  if (A.phase === "approach") {
    A.walk += dt * 0.02;
    A.refX = lerp(1.2, 0.66, Math.min(1, A.timer/1500));
    if (A.timer >= 1500) { A.phase = "give"; A.timer = 0; }
  } else if (A.phase === "give") {
    if (A.timer > 1300) { A.phase = "eat"; A.timer = 0; }
  } else if (A.phase === "eat") {
    // 손으로 치킨을 만지면 한 입씩! 조각이 사라짐
    const hit = chickenHit(A);
    for (const h of hands) {
      const hx = h.x*W, hy = h.y*H, key = h.label || "h";
      const L = A.lastHands[key] || { x: hx, y: hy };
      const sp = Math.hypot(hx - L.x, hy - L.y);
      A.lastHands[key] = { x: hx, y: hy };
      if (A.bitesLeft > 0 && A.biteCool <= 0 && Math.hypot(hx - hit.x, hy - hit.y) < hit.r && sp > 3) {
        A.bitesLeft--; A.biteCool = 420; A.chompT = 600; playKick();
        burst(hit.x, hit.y, "251,191,36", 18);
      }
    }
    if (A.bitesLeft <= 0 && A.timer > 600) { A.phase = "done"; A.timer = 0; }
  } else if (A.phase === "done") {
    if (!A.panelShown && A.timer > 700) { A.panelShown = true; showBeerPanel(); }
  }
  // 3D 치킨: 남은 조각만큼 크기, 살짝 흔들/회전 + 한 입 먹을 때 들썩
  if (A.loaded && A.beer) {
    const frac = Math.max(0, A.bitesLeft / A.bites);
    const target = A.baseScale * (0.12 + 0.88*frac);
    const cur = A.beer.scale.x;
    A.beer.scale.setScalar(lerp(cur, target, 0.18));
    A.beer.visible = A.bitesLeft > 0 || A.phase === "eat";
    const chomp = A.chompT > 0 ? Math.sin((600 - A.chompT)*0.02)*0.12 : 0;
    A.beer.position.y = A.baseY + 0.04 + chomp;
    A.beer.rotation.z = chomp*1.2;
    A.beer.rotation.y += dt * 0.0012;
  }
  updateParticles(dt);
}
function renderBeer(dt) {
  const A = GAME.beer;
  drawStadium();
  ctx.fillStyle = "rgba(251,191,36,0.07)"; ctx.fillRect(0, 0, W, H*0.5);   // 황금빛 분위기
  drawRef({ x: A.refX, y: 0.74, scale: 0.30, walk: A.walk });
  if (GAME.tracking) drawGloves(getCountry(GAME.userCode).colors.glove);
  drawParticles();
  threeRender();                                                          // 3D 치킨(Drumstick chicken.glb)
  if (!A.loaded) {
    ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(W*0.02)}px 'Segoe UI', sans-serif`;
    ctx.fillText("🍗 치킨 가져오는 중...", W/2, H*0.5);
  }
  // 먹는 단계: 안내 + 남은 조각 + 냠냠
  if (A.phase === "eat") {
    ctx.textAlign = "center";
    if (A.bitesLeft > 0) {
      const hit = chickenHit(A);
      ctx.save(); ctx.globalAlpha = 0.35 + 0.25*Math.sin(A.timer*0.006);
      ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(hit.x, hit.y, hit.r, 0, Math.PI*2); ctx.stroke(); ctx.restore();
      ctx.fillStyle = "#fde68a"; ctx.font = `bold ${Math.round(W*0.020)}px 'Segoe UI', sans-serif`;
      ctx.fillText("✋ 손으로 치킨을 만져서 한 입씩 먹어요!", W/2, H*0.86);
      ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(W*0.024)}px 'Segoe UI', sans-serif`;
      ctx.fillText("🍗 ".repeat(A.bitesLeft) || "", W/2, H*0.91);
    }
    if (A.chompT > 0) {
      ctx.save(); ctx.globalAlpha = clamp(A.chompT/400, 0, 1);
      ctx.fillStyle = "#fbbf24"; ctx.font = `900 ${Math.round(W*0.05)}px 'Segoe UI', sans-serif`;
      ctx.fillText("냠냠!", W/2, H*0.30); ctx.restore();
    }
  }
  let line = null;
  if (A.phase === "approach")    line = "골키퍼! 수고 많았어요 🍗";
  else if (A.phase === "give")   line = "조 1위 진출! 치킨 먹자! 🍗";
  else if (A.phase === "eat" && A.bitesLeft <= 0) line = "냠냠… 잘 먹었다! 🍗";
  if (line) speechBubble(clamp(A.refX*W, W*0.2, W*0.8), 0.74*H - 0.30*Math.min(W,H)*0.92, line);
}
function showBeerPanel() {
  threeHide();
  const me = getCountry(GAME.userCode);
  const userRank = sortedTable().findIndex(t => t.code === GAME.userCode) + 1;
  show(`
    <div class="panel wide">
      <div class="cup">🍗🏆</div>
      <h1 style="color:#4ade80">32강 진출 — 조 ${userRank}위! 🎉</h1>
      <p class="subtitle">${me.flag} ${me.name} — 완벽한 선방쇼! 손으로 직접 <b>치킨</b>을 한 입씩 냠냠! <b>치킨 먹자!</b> 🍗</p>
      ${miniTable()}
      <button id="againBtn">처음으로 돌아갈까요? ↻</button>
    </div>`);
  document.getElementById("againBtn").onclick = () => { GAME.beer = null; showDifficultySelect(); };
}

// ============================================================
//  조 2위 컷신: 동료 3명과 하이파이브(손으로 짝!)
// ============================================================
// a.palmY: 손바닥 높이(머리 위), a.done: 하이파이브 완료, a.flash: 짝! 섬광
function drawMate(a) {
  const s = a.scale * Math.min(W, H);
  ctx.save();
  ctx.translate(a.x*W, a.y*H - (a.bob || 0) * s);
  const jersey = a.color, jd = shade(a.color, -40), skin = "#d8a878";
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.beginPath(); ctx.ellipse(0, (a.bob||0)*s, s*0.20, 0.05*s, 0, 0, Math.PI*2); ctx.fill();
  const sw = Math.sin(a.walk || 0) * 0.10 * s;
  ctx.strokeStyle = "#caa078"; ctx.lineCap = "round"; ctx.lineWidth = s*0.09;
  ctx.beginPath(); ctx.moveTo(-s*0.05, -s*0.30); ctx.lineTo(-s*0.05 + sw, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.05, -s*0.30); ctx.lineTo(s*0.05 - sw, 0); ctx.stroke();
  ctx.fillStyle = "#14171e";
  ctx.beginPath(); ctx.ellipse(-s*0.05+sw, 0, s*0.06, s*0.035, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(s*0.05-sw, 0, s*0.06, s*0.035, 0, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = jersey; ctx.strokeStyle = jd; ctx.lineWidth = s*0.02;
  roundRect(-s*0.15, -s*0.58, s*0.30, s*0.30, s*0.06); ctx.fill(); ctx.stroke();
  // 한 팔은 자연스럽게 내리고, 한 팔(D쪽)을 위로 들어 손바닥 펼침(하이파이브 대기)
  const D = a.dir || 1;
  ctx.strokeStyle = jersey; ctx.lineWidth = s*0.08; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-s*0.10*D, -s*0.50); ctx.lineTo(-s*0.12*D, -s*0.30); ctx.stroke(); // 내린 팔
  const px = s*0.30*D, py = -s*1.02;                       // 든 손 위치(머리 위)
  const bounce = a.done ? 0 : Math.sin((a.t||0)*0.012)*s*0.04;
  ctx.beginPath(); ctx.moveTo(s*0.10*D, -s*0.52); ctx.lineTo(px, py + bounce); ctx.stroke();
  // 손바닥(펼친 손)
  ctx.fillStyle = a.done ? "#4ade80" : skin; ctx.strokeStyle = shade(a.done ? "#4ade80" : skin, -35); ctx.lineWidth = s*0.02;
  ctx.beginPath(); ctx.arc(px, py + bounce, s*0.085, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  for (let i = 0; i < 4; i++) {                            // 손가락
    const fa = -Math.PI*0.5 + (i-1.5)*0.32;
    ctx.lineWidth = s*0.03; ctx.strokeStyle = skin;
    ctx.beginPath(); ctx.moveTo(px, py + bounce); ctx.lineTo(px + Math.cos(fa)*s*0.11, py + bounce + Math.sin(fa)*s*0.11); ctx.stroke();
  }
  if (a.done) { ctx.fillStyle = "#fff"; ctx.font = `bold ${Math.round(s*0.10)}px 'Segoe UI'`; ctx.textAlign = "center"; ctx.fillText("✓", px, py + bounce + s*0.04); }
  // 머리
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -s*0.68, s*0.10, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#1a1410"; ctx.beginPath(); ctx.arc(0, -s*0.70, s*0.10, Math.PI*1.05, Math.PI*2.05); ctx.fill();
  ctx.restore();
  // 짝! 섬광
  if (a.flash > 0) {
    const fx = a.x*W + px, fy = a.y*H + py;
    ctx.save(); ctx.globalAlpha = clamp(a.flash, 0, 1);
    ctx.fillStyle = "#fde047"; ctx.font = `900 ${Math.round(s*0.4)}px 'Segoe UI'`; ctx.textAlign = "center";
    ctx.fillText("짝!", a.x*W + px, a.y*H + py - s*0.2);
    ctx.restore();
  }
}
// ---- 조 2위: 동료 3명과 하이파이브 ----
function startHighFiveScene(table) {
  GAME.screen = "highfive"; hudEl.classList.add("hidden"); uiEl.innerHTML = "";
  const col = getCountry(GAME.userCode).colors.primary;
  // 손바닥(palm) 목표 = 화면 좌표(정규화). 머리 위 높이.
  const mates = [
    { x: 0.28, y: 0.74, scale: 0.27, color: col, dir: 1,  done: false, flash: 0, t: 0 },
    { x: 0.50, y: 0.70, scale: 0.30, color: col, dir: 1,  done: false, flash: 0, t: 0 },
    { x: 0.72, y: 0.74, scale: 0.27, color: col, dir: -1, done: false, flash: 0, t: 0 },
  ];
  for (const m of mates) {                  // palm 화면 좌표 미리 계산
    const s = m.scale * Math.min(W, H);
    m.palm = { x: m.x + (0.30*m.dir*s)/W, y: m.y - (1.02*s)/H };
  }
  GAME.highfive = { phase: "play", timer: 0, panelShown: false, table, mates, slaps: 0, lastHands: {} };
}
function updateHighFive(dt) {
  const A = GAME.highfive; A.timer += dt;
  for (const m of A.mates) { m.t += dt; if (m.flash > 0) m.flash -= dt/450; }
  // 손으로 손바닥 터치 감지
  for (const h of hands) {
    const hx = h.x*W, hy = h.y*H, key = h.label || "h";
    const L = A.lastHands[key] || { x: hx, y: hy };
    const sp = Math.hypot(hx - L.x, hy - L.y);
    A.lastHands[key] = { x: hx, y: hy };
    for (const m of A.mates) {
      if (m.done) continue;
      const dx = hx - m.palm.x*W, dy = hy - m.palm.y*H;
      if (Math.hypot(dx, dy) < Math.min(W,H)*0.09 && sp > 3) {
        m.done = true; m.flash = 1; A.slaps++; playSlap();
        burst(m.palm.x*W, m.palm.y*H, "253,224,71", 16);
      }
    }
  }
  const allDone = A.mates.every(m => m.done);
  if (A.phase === "play") {
    if (allDone) { A.phase = "done"; A.timer = 0; }
    else if (A.timer > 12000) { A.phase = "done"; A.timer = 0; }   // 안전 타임아웃
  } else if (A.phase === "done") {
    if (!A.panelShown && A.timer > 900) { A.panelShown = true; showHighFivePanel(); }
  }
  updateParticles(dt);
}
function renderHighFive(dt) {
  const A = GAME.highfive;
  drawStadium();
  ctx.fillStyle = "rgba(74,222,128,0.06)"; ctx.fillRect(0, 0, W, H*0.5);
  for (const m of A.mates) {
    drawMate(m);
    if (!m.done) {     // 아직 안 친 손바닥에 안내 링
      const pulse = 0.5 + 0.5*Math.sin(m.t*0.008);
      ctx.save(); ctx.globalAlpha = 0.4 + pulse*0.4;
      ctx.strokeStyle = "#fde047"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(m.palm.x*W, m.palm.y*H, Math.min(W,H)*(0.05 + pulse*0.02), 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
  if (GAME.tracking) drawGloves(getCountry(GAME.userCode).colors.glove);
  drawParticles();
  const line = A.phase === "done"
    ? "우리가 해냈어!! 16강으로!! 🎉"
    : `손바닥을 손으로 쳐서 하이파이브! (${A.slaps}/3) ✋`;
  speechBubble(W*0.5, H*0.30, line);
}
function showHighFivePanel() {
  const me = getCountry(GAME.userCode);
  const r = sortedTable().findIndex(t => t.code === GAME.userCode) + 1;
  show(`
    <div class="panel wide">
      <div class="cup">✋🎟</div>
      <h1 style="color:#4ade80">32강 진출 — 조 ${r}위! 🎉</h1>
      <p class="subtitle">${me.flag} ${me.name} — 동료 3명과 짝짝짝 하이파이브! 함께 16강으로! 🙌</p>
      ${miniTable()}
      <button id="againBtn">처음으로 돌아갈까요? ↻</button>
    </div>`);
  document.getElementById("againBtn").onclick = () => { GAME.highfive = null; showDifficultySelect(); };
}

// ---- 조 4위: 경찰차 + 경찰관 2명 등장 ----
// 경찰관(여/남) 로드 — Idle 애니메이션 재생
function loadOfficer(name, x) {
  return loadGLB(name).then(g => {
    const o = g.scene, f = fitModel(o, 2.0);
    o.scale.setScalar(f.s);
    o.position.set(x, -f.box.min.y*f.s, 0.4);
    o.rotation.set(0, Math.PI, 0);
    three.content.add(o);
    let mixer = null;
    if (g.animations && g.animations.length) {
      mixer = new THREE.AnimationMixer(o);
      const idle = g.animations.find(a => /idle/i.test(a.name)) || g.animations[0];
      mixer.clipAction(idle).play();
    }
    return { obj: o, mixer };
  });
}
function startPoliceScene(table) {
  GAME.screen = "police"; hudEl.classList.add("hidden"); uiEl.innerHTML = "";
  threeBegin();
  GAME.police = { phase: "approach", timer: 0, t: 0, cuffT: 0, panelShown: false, table, car: null, fem: null, male: null };
  three.camera.position.set(0, 1.7, 7); three.camera.lookAt(0, 1.0, 0); three.camera.updateProjectionMatrix();
  loadGLB("Police Car.glb").then(g => {
    const car = g.scene, f = fitModel(car, 3.6);
    car.scale.setScalar(f.s);
    car.position.set(0, -f.box.min.y*f.s, -2.2);
    car.rotation.set(0, Math.PI*0.12, 0);
    three.content.add(car);
    GAME.police.car = car;
  }).catch(() => {});
  loadOfficer("Female Officer.glb", -1.5).then(o => { GAME.police.fem = o; }).catch(() => {});
  loadOfficer("Male Officer.glb", 1.5).then(o => { GAME.police.male = o; }).catch(() => {});
}
function updatePolice(dt) {
  const A = GAME.police; A.timer += dt; A.t += dt;
  for (const o of [A.fem, A.male]) if (o && o.mixer) o.mixer.update(dt/1000);
  if (A.phase === "approach") {
    const p = Math.min(1, A.timer/1600);
    if (A.car) A.car.position.z = lerp(-9, -2.2, p);
    if (A.fem) A.fem.obj.position.z = lerp(-4, 0.4, p);
    if (A.male) A.male.obj.position.z = lerp(-4, 0.4, p);
    if (A.timer > 1700) { A.phase = "command"; A.timer = 0; }
  } else if (A.phase === "command") {
    if (A.timer > 2300) { A.phase = "cuff"; A.timer = 0; }
  } else if (A.phase === "cuff") {
    A.cuffT = Math.min(1, A.timer / 1300);
    if (A.timer > 1700) { A.phase = "done"; A.timer = 0; }
  } else if (A.phase === "done") {
    A.cuffT = 1;
    if (!A.panelShown && A.timer > 700) { A.panelShown = true; showPolicePanel(); }
  }
  updateParticles(dt);
}
function renderPolice(dt) {
  const A = GAME.police;
  drawStadium();
  // 경광등(적·청 점멸)
  const sir = Math.sin(A.t * 0.012);
  ctx.fillStyle = `rgba(${sir > 0 ? "239,68,68" : "59,130,246"},${0.10 + 0.07*Math.abs(sir)})`;
  ctx.fillRect(0, 0, W, H*0.5);
  if (GAME.tracking) drawGloves(getCountry(GAME.userCode).colors.glove);
  if (A.phase === "cuff" || A.phase === "done") drawCuffs(A.cuffT);   // 추적된 양손에 수갑+체인
  drawParticles();
  threeRender();
  if (!A.car && !A.fem && !A.male) {
    ctx.fillStyle = "#cbd5e1"; ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(W*0.02)}px 'Segoe UI', sans-serif`;
    ctx.fillText("🚓 출동 중...", W/2, H*0.5);
  }
  let line = "두 손 보이게 하세요!";
  if (A.phase === "approach") line = "…거기 골키퍼!";
  else if (A.phase === "cuff" || A.phase === "done") line = "당신을 체포합니다! 🔗";
  speechBubble(W*0.5, H*0.28, line);
  // 손 미인식 안내(수갑 채우려면 손이 보여야 함)
  if ((A.phase === "command" || A.phase === "cuff") && hands.length < 2) {
    ctx.fillStyle = "rgba(255,255,255,0.92)"; ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(W*0.018)}px 'Segoe UI', sans-serif`;
    ctx.fillText("✋✋ 두 손을 카메라에 보이세요", W/2, H*0.92);
  }
}
function showPolicePanel() {
  threeHide();
  const me = getCountry(GAME.userCode);
  const r = sortedTable().findIndex(t => t.code === GAME.userCode) + 1;
  show(`
    <div class="panel wide">
      <div class="cup">🚓✋</div>
      <h1 style="color:#f87171">조 ${r}위 — 16강 진출 실패</h1>
      <p class="subtitle">${me.flag} ${me.name} — 경찰차가 출동! 두 경찰관이 <b>"두 손 보이게 하세요!"</b> 외치고 <b>철컹—</b> 수갑까지 🚓🔗 다음엔 꼭 막아내자!</p>
      ${miniTable()}
      <button id="againBtn">처음으로 돌아갈까요? ↻</button>
    </div>`);
  document.getElementById("againBtn").onclick = () => { GAME.police = null; showDifficultySelect(); };
}

// ============================================================
//  조 3위 컷신: 감독이 골키퍼에게 뺨 5대
// ============================================================
function drawManager(a) {
  const s = a.scale * Math.min(W, H);
  ctx.save();
  ctx.translate(a.x*W, a.y*H);
  ctx.scale(a.face || 1, 1);     // 골키퍼 쪽을 바라봄
  const suit = "#33384a", suitD = "#222634", skin = "#e0b48c", shirt = "#e5e7eb";
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.24, 0.055*s, 0, 0, Math.PI*2); ctx.fill();
  const sw = Math.sin(a.walk || 0) * 0.08 * s;
  ctx.strokeStyle = "#1a1d24"; ctx.lineCap = "round"; ctx.lineWidth = s*0.10;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.30); ctx.lineTo(-s*0.06 + sw, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.06, -s*0.30); ctx.lineTo(s*0.06 - sw, 0); ctx.stroke();
  ctx.fillStyle = suit; ctx.strokeStyle = suitD; ctx.lineWidth = s*0.02;
  roundRect(-s*0.17, -s*0.60, s*0.34, s*0.32, s*0.05); ctx.fill(); ctx.stroke();
  ctx.fillStyle = shirt; ctx.beginPath(); ctx.moveTo(0, -s*0.60); ctx.lineTo(-s*0.05, -s*0.34); ctx.lineTo(s*0.05, -s*0.34); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#c0392b"; ctx.fillRect(-s*0.015, -s*0.52, s*0.03, s*0.16);
  // 뒷팔
  ctx.strokeStyle = suit; ctx.lineWidth = s*0.085; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-s*0.12, -s*0.52); ctx.lineTo(-s*0.18, -s*0.34); ctx.stroke();
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(-s*0.18, -s*0.34, s*0.045, 0, Math.PI*2); ctx.fill();
  // 때리는 팔(swing 0→1: 위뒤 → 앞으로 휘두름)
  const ang = lerp(-2.4, -0.15, a.swing || 0);
  const [ex, ey] = rp(s*0.12, -s*0.52, s*0.34, ang);
  ctx.strokeStyle = suit; ctx.lineWidth = s*0.085;
  ctx.beginPath(); ctx.moveTo(s*0.12, -s*0.52); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(ex, ey, s*0.055, 0, Math.PI*2); ctx.fill();
  // 머리
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -s*0.70, s*0.11, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#3a3a3a"; ctx.beginPath(); ctx.arc(0, -s*0.72, s*0.11, Math.PI*1.05, Math.PI*2.05); ctx.fill();
  ctx.restore();
}
// 뺨 맞는 골키퍼(나) 아바타 — recoil로 머리/상체가 휙 젖혀짐
function drawSlapKeeper(cx, cy, s, recoil, cheek, gcol) {
  ctx.save();
  ctx.translate(cx, cy);
  const jd = shade(gcol, -40), skin = "#d8a878";
  ctx.fillStyle = "rgba(0,0,0,0.26)";
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.20, 0.05*s, 0, 0, Math.PI*2); ctx.fill();
  // 다리(맞아서 약간 밀림)
  const slide = recoil * 0.15 * s;
  ctx.strokeStyle = "#caa078"; ctx.lineCap = "round"; ctx.lineWidth = s*0.09;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.30); ctx.lineTo(-s*0.11 + slide, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.06, -s*0.30); ctx.lineTo(s*0.09 + slide, 0); ctx.stroke();
  ctx.fillStyle = "#14171e";
  ctx.beginPath(); ctx.ellipse(-s*0.11+slide, 0, s*0.06, s*0.035, 0, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(s*0.09+slide, 0, s*0.06, s*0.035, 0, 0, Math.PI*2); ctx.fill();
  // 상체(허리에서 recoil 회전)
  ctx.save();
  ctx.translate(0, -s*0.30); ctx.rotate(recoil * 0.40);
  ctx.fillStyle = gcol; ctx.strokeStyle = jd; ctx.lineWidth = s*0.02;
  roundRect(-s*0.15, -s*0.30, s*0.30, s*0.30, s*0.06); ctx.fill(); ctx.stroke();
  // 골키퍼 장갑 양손(방어 자세)
  ctx.strokeStyle = gcol; ctx.lineWidth = s*0.08; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-s*0.10, -s*0.22); ctx.lineTo(-s*0.24, -s*0.30); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(s*0.10, -s*0.22); ctx.lineTo(s*0.20, -s*0.40); ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(-s*0.24, -s*0.30, s*0.05, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(s*0.20, -s*0.40, s*0.05, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = gcol;
  ctx.beginPath(); ctx.arc(-s*0.24, -s*0.30, s*0.03, 0, Math.PI*2); ctx.fill();
  ctx.beginPath(); ctx.arc(s*0.20, -s*0.40, s*0.03, 0, Math.PI*2); ctx.fill();
  // 머리(추가 회전)
  ctx.save();
  ctx.translate(0, -s*0.30); ctx.rotate(recoil * 0.55);
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -s*0.10, s*0.12, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#1a1410"; ctx.beginPath(); ctx.arc(0, -s*0.12, s*0.12, Math.PI*1.05, Math.PI*2.05); ctx.fill();
  if (cheek > 0) {   // 빨개진 뺨(감독 쪽)
    ctx.fillStyle = `rgba(239,68,68,${0.65*cheek})`;
    ctx.beginPath(); ctx.arc(s*0.075, -s*0.07, s*0.05, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();
  ctx.restore();
  ctx.restore();
}

function startSlapScene(table) {
  GAME.screen = "slap"; hudEl.classList.add("hidden"); uiEl.innerHTML = "";
  audioInit();
  GAME.slap = { phase: "approach", timer: 0, mgrX: 1.2, walk: 0, slaps: 0, swing: 0,
                flash: 0, shake: 0, recoil: 0, recoilV: 0, cheek: 0, hitDone: false, panelShown: false, table };
}
function updateSlap(dt) {
  const A = GAME.slap; A.timer += dt;
  A.flash = Math.max(0, A.flash - dt/250);
  A.shake = Math.max(0, A.shake - dt/200);
  A.cheek = Math.max(0, A.cheek - dt/700);
  // 머리 회복 스프링(맞으면 휙, 천천히 제자리)
  A.recoilV += (-A.recoil * 0.05 - A.recoilV * 0.18);
  A.recoil += A.recoilV;
  if (A.phase === "approach") {
    A.walk += dt*0.02;
    A.mgrX = lerp(1.2, 0.60, Math.min(1, A.timer/1400));
    if (A.timer >= 1400) { A.phase = "slapping"; A.timer = 0; A.slaps = 0; A.hitDone = false; }
  } else if (A.phase === "slapping") {
    A.swing = (A.timer % 560) / 560;
    if (A.swing < 0.1) A.hitDone = false;
    if (A.swing > 0.5 && !A.hitDone) {          // 손이 뺨에 닿는 순간
      A.hitDone = true; A.slaps++;
      A.recoilV -= 0.55;                        // 머리가 옆으로 홱
      A.cheek = 1; A.flash = 1; A.shake = 1;
      playSlap();                               // 짝! 소리
      burst(0.47*W, 0.46*H, "248,113,113", 10);
      if (A.slaps >= 5) { A.phase = "done"; A.timer = 0; }
    }
  } else if (A.phase === "done") {
    if (!A.panelShown && A.timer > 900) { A.panelShown = true; showSlapPanel(); }
  }
  updateParticles(dt);
}
function renderSlap(dt) {
  const A = GAME.slap;
  ctx.save();
  if (A.shake > 0) ctx.translate((Math.random()*2-1)*12*A.shake, (Math.random()*2-1)*12*A.shake);
  drawStadium();
  const s = 0.30 * Math.min(W, H);
  // 골키퍼(나, 오른쪽의 감독을 바라봄)
  drawSlapKeeper(0.42*W, 0.78*H, s, A.recoil, A.cheek, getCountry(GAME.userCode).colors.glove);
  // 감독(왼쪽의 골키퍼를 향해 뺨을 때림)
  const swing = A.phase === "slapping" ? Math.sin(A.swing * Math.PI) : 0;
  drawManager({ x: A.mgrX, y: 0.78, scale: 0.30, walk: A.walk, swing, face: -1 });
  drawParticles();
  if (A.flash > 0) {
    ctx.fillStyle = `rgba(248,113,113,${A.flash*0.35})`; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.textAlign = "center";
    ctx.font = `900 ${Math.round(W*0.075)}px 'Segoe UI', sans-serif`;
    ctx.lineWidth = 5; ctx.strokeStyle = "#b91c1c"; ctx.fillStyle = "#fff";
    ctx.strokeText("짝!", W*0.53, H*0.54); ctx.fillText("짝!", W*0.53, H*0.54);
    ctx.restore();
  }
  // 말풍선: 감독 + 골키퍼
  if (A.phase === "approach") {
    speechBubble(clamp(A.mgrX*W, W*0.2, W*0.8), 0.78*H - s*0.95, "너 이리 와봐!! 😡");
  } else if (A.phase === "slapping") {
    speechBubble(clamp(A.mgrX*W, W*0.28, W*0.85), 0.78*H - s*0.95, `정신 차려!! (${Math.min(A.slaps, 5)}/5)`);
    speechBubble(clamp(0.42*W, W*0.20, W*0.55), 0.78*H - s*1.30, "감독님, 전략 전술을 어떻게 짰길래~! 😫");
  }
  ctx.restore();
}
function showSlapPanel() {
  const me = getCountry(GAME.userCode);
  const r = sortedTable().findIndex(t => t.code === GAME.userCode) + 1;
  show(`
    <div class="panel wide">
      <div class="cup">😵👋</div>
      <h1 style="color:#f87171">조 ${r}위 — 16강 진출 실패</h1>
      <p class="subtitle">${me.flag} ${me.name} — 감독에게 뺨 5대! "정신 차려!!" 다음엔 꼭 막자 😤</p>
      ${miniTable()}
      <button id="againBtn">처음으로 돌아갈까요? ↻</button>
    </div>`);
  document.getElementById("againBtn").onclick = () => { GAME.slap = null; showDifficultySelect(); };
}

// ============================================================
//  공격수 변신 모드 (손흥민 찰칵 → 발로 차기 · 발 추적)
// ============================================================
let STRIKER = null;
// 난이도 → 골키퍼 능력치 (쉬움=허술, 레전드=세계최고)
function strikerKeeperSkill() {
  const L = GAME.difficulty || LEVELS[1];
  const idx = Math.max(0, LEVELS.indexOf(L));
  const f = idx / (LEVELS.length - 1);          // 0(쉬움)~1(레전드)
  return {
    label: L.label, emoji: L.emoji, f,
    react: lerp(470, 95, f),        // 반응 지연(ms) — 어려울수록 빠름
    diveSpeed: lerp(0.0016, 0.0044, f), // 다이브 속도(goal폭 단위/ms)
    reach: lerp(0.34, 0.94, f),     // 선방 반경(goal폭 단위) — 어려울수록 넓음
    err: lerp(0.95, 0.12, f),       // 예측 오차 — 어려울수록 정확
  };
}
// 먼 골대 기하 (drawFarGoal과 동일)
function farGoal() { return { cx: W*0.5, topY: H*0.16, gw: W*0.34, gh: H*0.16 }; }
function newStrikerState() {
  return {
    phase: "ready", flash: 1, last: {}, kicks: 0, goals: 0, saves: 0, misses: 0,
    ball: { x: 0.5*W, y: 0.80*H, scale: 1, spin: 0, spinAng: 0 },
    shot: null,                 // 비행 중 슛 파라미터
    impact: null,               // 마지막 임팩트 지점(다이어그램용)
    keeper: { x: 0, guess: 0, react: 0, committed: false, dive: 0 },
    result: null, resultT: 0,
    skill: strikerKeeperSkill(),
  };
}
function enterStrikerMode() {
  ensurePose();
  audioInit();
  GAME.returnScreen = GAME.screen;
  GAME.screen = "striker";
  GAME.inputMode = "foot";
  feet = [];
  hudEl.classList.add("hidden");
  uiEl.innerHTML = "";
  STRIKER = newStrikerState();
  strikerExitBtn.classList.remove("hidden");
}
// 슛! — 발이 공을 차는 순간: 방향·강도·회전·임팩트 지점 산출
function kickBall(S, f) {
  const g = farGoal(), minWH = Math.min(W, H), b = S.ball;
  const br = minWH * 0.05 * b.scale;
  const sp = Math.hypot(f.vx, f.vy);
  // 임팩트 지점: 공 중심 → 발 위치 (정규화 -1~1, 공 표면 기준)
  let ox = (f.sx - b.x) / br, oy = (f.sy - b.y) / br;
  const om = Math.hypot(ox, oy) || 1;
  if (om > 1) { ox /= om; oy /= om; }
  // 발 진행 방향
  const dirA = Math.atan2(f.vy, f.vx);
  // 진행방향에 수직인 임팩트 오프셋 → 회전(감아차기). 발 각도가 빗맞을수록 회전↑
  const perp = ox * Math.cos(dirA + Math.PI/2) + oy * Math.sin(dirA + Math.PI/2);
  const spin = clamp(-perp * 1.15, -1, 1);
  // 강도(파워): 발 속도
  const power = clamp(sp / 26, 0.45, 1.5);
  // 좌우 조준: 발 가로 속도 + 임팩트 가로 오프셋(반대로 밀림)
  const gx = clamp(f.vx / 22 - ox * 0.45, -1.25, 1.25);
  // 상하 조준: 위로 강하게 찰수록 높게 (gy 1=바닥, -1=상단)
  const gy = clamp(0.55 + f.vy / 55 + (power - 0.9) * 0.25, -1.0, 1.0);
  const tx = g.cx + gx * (g.gw * 0.5 * 0.95);
  const ty = g.topY + g.gh * (0.5 - gy * 0.42);
  S.shot = { kx: b.x, ky: b.y, tx, ty, gx, gy, spin, power, t: 0,
             dur: lerp(1150, 620, clamp((power - 0.45) / 1.05, 0, 1)),
             curveAmp: spin * W * 0.13 };
  S.impact = { ox, oy, spin, power, t: 2400 };
  b.spin = spin;
  S.phase = "flying"; S.kicks++; S.result = null; S.resultT = 0;
  playKick();
  // 골키퍼: 반응 지연 후 예측 지점으로 다이브
  S.keeper.committed = false;
  S.keeper.react = S.skill.react;
  S.keeper.guess = clamp(gx + (Math.random() * 2 - 1) * S.skill.err, -1.15, 1.15);
}
function updateShot(S, dt) {
  const sh = S.shot, b = S.ball;
  sh.t += dt / sh.dur;
  if (sh.t >= 1) { sh.t = 1; resolveShot(S); return; }
  const t = sh.t;
  const curve = Math.sin(t * Math.PI) * sh.curveAmp;          // 감아차기(바나나 궤적)
  b.x = lerp(sh.kx, sh.tx, t) + curve;
  b.y = lerp(sh.ky, sh.ty, Math.pow(t, 0.85)) - Math.sin(t * Math.PI) * H * 0.06 * sh.power;
  b.scale = lerp(1, 0.34, t);
  b.spinAng += 0.25 + Math.abs(sh.spin) * 0.55;
}
function resolveShot(S) {
  const sh = S.shot, g = farGoal();
  const onTarget = Math.abs(sh.gx) <= 1 && sh.gy >= -1 && sh.gy <= 1;
  const dx = Math.abs(S.keeper.x - sh.gx);
  const saved = onTarget && dx < S.skill.reach;
  S.ball.x = g.cx + sh.gx * (g.gw * 0.5 * 0.95);
  S.ball.y = g.topY + g.gh * (0.5 - sh.gy * 0.42);
  if (!onTarget) { S.result = "miss"; S.misses++; }
  else if (saved) {
    S.result = "save"; S.saves++; playSlap();
    S.keeper.x = sh.gx; S.keeper.dive = 1;                    // 공 쪽으로 붙어 선방
    burst(S.ball.x, S.ball.y, "147,197,253", 16);
  } else {
    S.result = "goal"; S.goals++; playKick();
    burst(S.ball.x, S.ball.y, "74,222,128", 24);
  }
  S.phase = "result"; S.resultT = 0;
}
function updateKeeper(S, dt) {
  const k = S.keeper;
  if (S.phase === "flying") {
    if (k.react > 0) { k.react -= dt; }
    else {
      k.committed = true;
      const step = S.skill.diveSpeed * dt;
      if (Math.abs(k.guess - k.x) <= step) k.x = k.guess;
      else k.x += Math.sign(k.guess - k.x) * step;
      k.dive = clamp(Math.abs(k.x) * 1.1, 0, 1);
    }
  } else if (S.phase === "ready") {
    k.x = lerp(k.x, 0, 0.06); k.dive = lerp(k.dive, 0, 0.1);  // 중앙 복귀
  }
}
function resetStrikerBall(S) {
  S.ball = { x: 0.5*W, y: 0.80*H, scale: 1, spin: 0, spinAng: S.ball.spinAng };
  S.shot = null; S.phase = "ready"; S.result = null;
}
function exitStrikerMode() {
  GAME.inputMode = "hand"; feet = []; STRIKER = null;
  strikerExitBtn.classList.add("hidden");
  const rs = GAME.returnScreen;
  if (rs === "play" && GAME.match) { GAME.screen = "play"; hudEl.classList.remove("hidden"); uiEl.innerHTML = ""; }
  else if (rs === "country") showCountrySelect();
  else if (rs === "keeper") showKeeperSelect();
  else if (rs === "intro") showMatchIntro();
  else showDifficultySelect();
}
function drawFarGoal() {
  const cx = W*0.5, topY = H*0.16, gw = W*0.34, gh = H*0.16;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = cx-gw/2; x <= cx+gw/2; x += gw/10) { ctx.moveTo(x, topY); ctx.lineTo(x, topY+gh); }
  for (let y = topY; y <= topY+gh; y += gh/6) { ctx.moveTo(cx-gw/2, y); ctx.lineTo(cx+gw/2, y); }
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineWidth = 8; ctx.lineJoin = "round";
  ctx.strokeRect(cx-gw/2, topY, gw, gh);
  ctx.restore();
}
function drawBoot(x, y, s) {
  ctx.save(); ctx.translate(x, y);
  const g = ctx.createRadialGradient(0, 0, s*0.2, 0, 0, s*1.2);
  g.addColorStop(0, "rgba(34,211,238,0.5)"); g.addColorStop(1, "rgba(34,211,238,0)");
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, s*1.2, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#14171e"; ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = s*0.12;
  ctx.beginPath(); ctx.ellipse(0, 0, s*0.8, s*0.5, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#22d3ee"; ctx.beginPath(); ctx.arc(s*0.5, 0, s*0.18, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}
function updateStriker(dt) {
  const S = STRIKER; if (!S) return;
  S.flash = Math.max(0, S.flash - dt/500);
  if (S.impact) S.impact.t -= dt;
  const b = S.ball, minWH = Math.min(W, H);
  // 발 위치/속도 갱신
  for (const f of feet) {
    const fx = f.x*W, fy = f.y*H, L = S.last[f.side];
    f.sx = fx; f.sy = fy; f.vx = L ? fx - L.x : 0; f.vy = L ? fy - L.y : 0;
    S.last[f.side] = { x: fx, y: fy };
  }
  if (S.phase === "ready") {
    b.spinAng += 0.02;
    const br = minWH*0.05*b.scale;
    for (const f of feet) {
      const sp = Math.hypot(f.vx, f.vy);
      if (Math.hypot(f.sx - b.x, f.sy - b.y) < br + minWH*0.05 && sp > 14) { kickBall(S, f); break; }
    }
  } else if (S.phase === "flying") {
    updateShot(S, dt);
  } else if (S.phase === "result") {
    S.resultT += dt;
    if (S.resultT > 1500) resetStrikerBall(S);
  }
  updateKeeper(S, dt);
  updateParticles(dt);
}
function renderStriker(dt) {
  const S = STRIKER; if (!S) return;
  drawStadium(false);         // 손흥민 모드: 내 골대(가까운 골대) 숨김
  drawScoreboard(S);          // 왼쪽 사용자 화면(전광판, 내 전신)
  drawFarGoal();              // 상대방 골대만 표시
  drawKeeperFar(S);           // 골키퍼
  const b = S.ball, br = Math.min(W,H)*0.05*b.scale;
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath(); ctx.ellipse(b.x, b.y + br*0.9, br*0.9, br*0.3, 0, 0, Math.PI*2); ctx.fill();
  drawSoccerBall(b.x, b.y, br, b.spinAng);
  // 임팩트 지점 마커(공 위) — 비행 초반에 어디를 찼는지 표시
  if (S.phase === "flying" && S.shot.t < 0.55 && S.impact) {
    const ix = b.x + S.impact.ox*br, iy = b.y + S.impact.oy*br;
    ctx.fillStyle = "#f43f5e"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ix, iy, br*0.24, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  }
  for (const f of feet) drawBoot(f.x*W, f.y*H, Math.min(W,H)*0.05);
  drawParticles();
  // 임팩트 다이어그램(좌하단)
  if (S.impact && S.impact.t > 0) drawImpactDiagram(S.impact);
  // 상단 HUD
  ctx.textAlign = "center"; ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(W*0.020)}px 'Segoe UI', sans-serif`;
  ctx.fillText(`⚽ 손흥민 모드   골 ${S.goals} · 선방 ${S.saves} · 슛 ${S.kicks}`, W/2, H*0.385);
  ctx.fillStyle = "#fbbf24"; ctx.font = `bold ${Math.round(W*0.015)}px 'Segoe UI', sans-serif`;
  ctx.fillText(`${S.skill.emoji} 골키퍼 난이도: ${S.skill.label}`, W/2, H*0.385 + Math.round(W*0.026));
  // 결과 배너
  if (S.phase === "result" && S.result) drawStrikerResult(S);
  // 변신 플래시
  if (S.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${S.flash*0.5})`; ctx.fillRect(0, 0, W, H); }
  if (S.flash > 0.25) {
    ctx.fillStyle = "#fbbf24"; ctx.textAlign = "center"; ctx.font = `900 ${Math.round(W*0.05)}px 'Segoe UI', sans-serif`;
    ctx.fillText("⚽ 공격수 변신!", W/2, H*0.50);
  }
  // 발 미인식 안내 — 왼쪽 사용자 화면(전광판) 아래
  const sbx = W*0.025, sby = H*0.06, sbw = W*0.16, sbh = H*0.50;
  const gx = sbx, gy = sby + sbh + 60;   // 화면 라벨(🔴 LIVE) 아래
  ctx.textAlign = "left";
  if (feet.length === 0) {
    ctx.fillStyle = "#f87171"; ctx.font = `bold ${Math.round(W*0.012)}px 'Segoe UI', sans-serif`;
    ctx.fillText("🦵 발이 카메라에 보이도록", gx, gy);
    ctx.fillText("뒤로 물러서세요 (전신이 보이게)", gx, gy + Math.round(W*0.018));
  } else if (S.phase === "ready") {
    ctx.fillStyle = "#a7f3d0"; ctx.font = `bold ${Math.round(W*0.012)}px 'Segoe UI', sans-serif`;
    ctx.fillText("🦶 공 옆에서 발을 빠르게 휘둘러 슛!", gx, gy);
    ctx.fillText("(빗맞히면 감아차기 회전)", gx, gy + Math.round(W*0.018));
  }
}
// ---- 골대 뒤 전광판: 웹캠으로 내 전신 표시(거울) + 발 추적 마커 ----
function drawScoreboard(S) {
  const bw = W*0.16, bh = H*0.50, bx = W*0.025, by = H*0.06;
  ctx.save();
  // 프레임
  ctx.fillStyle = "#0a0e16"; roundRect(bx-10, by-8, bw+20, bh+42, 14); ctx.fill();
  ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 3; roundRect(bx-10, by-8, bw+20, bh+42, 14); ctx.stroke();
  // 영상(거울, cover)
  ctx.save();
  roundRect(bx, by, bw, bh, 8); ctx.clip();
  ctx.fillStyle = "#05070c"; ctx.fillRect(bx, by, bw, bh);
  if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth) {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight, sc = Math.max(bw/vw, bh/vh);
    ctx.translate(bx + bw/2, by + bh/2); ctx.scale(-1, 1);   // 거울
    ctx.drawImage(videoEl, -vw*sc/2, -vh*sc/2, vw*sc, vh*sc);
  } else {
    ctx.fillStyle = "#64748b"; ctx.textAlign = "center";
    ctx.font = `bold ${Math.round(W*0.014)}px 'Segoe UI', sans-serif`;
    ctx.fillText("📡 전광판 연결 중…", bx + bw/2, by + bh/2);
  }
  ctx.restore();
  // 발 추적 마커(전광판 좌표)
  for (const f of feet) {
    const mx = bx + f.x*bw, my = by + f.y*bh;
    ctx.fillStyle = "#22d3ee"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(mx, my, 5, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  }
  // 라벨
  ctx.textAlign = "left"; ctx.fillStyle = "#f87171";
  ctx.font = `bold ${Math.round(W*0.013)}px 'Segoe UI', sans-serif`;
  ctx.fillText("🔴 LIVE", bx, by + bh + 22);
  ctx.fillStyle = "#22d3ee"; ctx.textAlign = "right";
  ctx.fillText("전광판 · 내 전신", bx + bw, by + bh + 22);
  ctx.restore();
}
// ---- 골키퍼 (먼 골대 안, 다이브 애니메이션) ----
function drawKeeperFar(S) {
  const g = farGoal(), k = S.keeper;
  const cx = g.cx + k.x * (g.gw*0.5*0.92);
  const baseY = g.topY + g.gh*0.99;
  const s = Math.min(W,H)*0.105, ext = k.dive, lean = k.x*0.45;
  const dir = k.x >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(cx, baseY); ctx.rotate(lean*0.45);
  const jersey = "#16a34a", jd = "#0f7a36", skin = "#e0b48c", glove = "#fde047";
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(0, 2, s*0.5, s*0.12, 0, 0, Math.PI*2); ctx.fill();
  // 다리(다이브 시 벌어짐)
  ctx.strokeStyle = "#1f2937"; ctx.lineCap = "round"; ctx.lineWidth = s*0.16;
  ctx.beginPath(); ctx.moveTo(-s*0.06, -s*0.55); ctx.lineTo(-s*0.18 - ext*s*0.25, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( s*0.06, -s*0.55); ctx.lineTo( s*0.18 + ext*s*0.25, 0); ctx.stroke();
  // 몸통
  ctx.fillStyle = jersey; ctx.strokeStyle = jd; ctx.lineWidth = s*0.04;
  roundRect(-s*0.22, -s*1.0, s*0.44, s*0.5, s*0.1); ctx.fill(); ctx.stroke();
  // 팔(공 쪽으로 쭉 뻗음)
  const a1x = (0.18 + ext*0.35)*s*dir, a1y = -s*(0.92) - ext*s*0.28;
  const a2x = (0.34 + ext*0.62)*s*dir, a2y = -s*(0.92) - ext*s*0.52;
  ctx.strokeStyle = jersey; ctx.lineWidth = s*0.13; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-s*0.10, -s*0.90); ctx.lineTo(a1x, a1y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo( s*0.10, -s*0.90); ctx.lineTo(a2x, a2y); ctx.stroke();
  // 장갑
  ctx.fillStyle = glove; ctx.strokeStyle = "#a16207"; ctx.lineWidth = s*0.03;
  for (const [hx, hy] of [[a1x, a1y], [a2x, a2y]]) { ctx.beginPath(); ctx.arc(hx, hy, s*0.14, 0, Math.PI*2); ctx.fill(); ctx.stroke(); }
  // 머리
  ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -s*1.12, s*0.16, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = "#1a1410"; ctx.beginPath(); ctx.arc(0, -s*1.16, s*0.16, Math.PI*1.05, Math.PI*2.05); ctx.fill();
  ctx.restore();
}
// ---- 임팩트 지점 다이어그램(발이 공 어디를 찼는지) ----
function drawImpactDiagram(im) {
  const r = Math.min(W,H)*0.07, cx = W*0.12, cy = H*0.74;
  ctx.save();
  ctx.globalAlpha = clamp(im.t/600, 0, 1);
  ctx.fillStyle = "rgba(8,12,20,0.82)"; ctx.strokeStyle = "#f43f5e"; ctx.lineWidth = 2;
  roundRect(cx - r*1.55, cy - r*1.75, r*3.1, r*3.5, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center";
  ctx.font = `bold ${Math.round(W*0.014)}px 'Segoe UI', sans-serif`;
  ctx.fillText("⚽ 임팩트 지점", cx, cy - r*1.3);
  drawSoccerBall(cx, cy, r, 0);
  const ix = cx + im.ox*r, iy = cy + im.oy*r, ang = Math.atan2(im.oy, im.ox);
  // 발이 들어오는 방향 화살표
  ctx.strokeStyle = "#22d3ee"; ctx.lineWidth = 4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(cx + Math.cos(ang)*r*1.95, cy + Math.sin(ang)*r*1.95); ctx.lineTo(ix, iy); ctx.stroke();
  ctx.fillStyle = "#f43f5e"; ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(ix, iy, r*0.17, 0, Math.PI*2); ctx.fill(); ctx.stroke();
  // 회전/파워 라벨
  const sp = Math.round(Math.abs(im.spin)*100);
  const spinTxt = Math.abs(im.spin) < 0.18 ? "똑바로 정타" : (im.spin > 0 ? `◀ 감아차기 ${sp}%` : `감아차기 ${sp}% ▶`);
  ctx.textAlign = "center";
  ctx.fillStyle = "#fbbf24"; ctx.font = `bold ${Math.round(W*0.013)}px 'Segoe UI', sans-serif`;
  ctx.fillText(spinTxt, cx, cy + r*1.55);
  ctx.fillStyle = "#93c5fd";
  ctx.fillText(`파워 ${Math.round(im.power/1.5*100)}%`, cx, cy + r*1.55 + Math.round(W*0.018));
  ctx.restore();
}
// ---- 슛 결과 배너 ----
function drawStrikerResult(S) {
  const map = {
    goal: ["⚽ G O A L !", "#4ade80", "키퍼를 뚫었다! 손흥민!! 🔥"],
    save: ["🧤 SAVE!", "#93c5fd", "골키퍼 선방! 다시 도전!"],
    miss: ["✈ 빗나감…", "#f87171", "조준이 빗나갔어요"],
  };
  const m = map[S.result]; if (!m) return;
  ctx.save(); ctx.textAlign = "center";
  ctx.fillStyle = m[1]; ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 18;
  ctx.font = `900 ${Math.round(W*0.06)}px 'Segoe UI', sans-serif`;
  ctx.fillText(m[0], W/2, H*0.55);
  ctx.shadowBlur = 0; ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.round(W*0.020)}px 'Segoe UI', sans-serif`;
  ctx.fillText(m[2], W/2, H*0.55 + Math.round(W*0.045));
  ctx.restore();
}

// ============================================================
//  조 3위 컷신: 강아지(Shiba Inu .glb) 쓰담쓰담 → "집에 가자"
// ============================================================
// ---- 공용 3D 시스템 (#three 캔버스 공유, 씬마다 content 교체) ----
let three = null;
const GLB = {};
function initThree() {
  if (three || typeof THREE === "undefined") return;
  const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(W, H, false);
  if ("outputEncoding" in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.05));
  const d1 = new THREE.DirectionalLight(0xffffff, 1.1); d1.position.set(2, 5, 4); scene.add(d1);
  const d2 = new THREE.DirectionalLight(0xffffff, 0.4); d2.position.set(-3, 2, -2); scene.add(d2);
  const content = new THREE.Group(); scene.add(content);
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
  three = { renderer, scene, camera, content };
}
function loadGLB(name) {
  return new Promise((res, rej) => {
    if (GLB[name]) { res(GLB[name]); return; }
    if (typeof THREE === "undefined" || !THREE.GLTFLoader) { rej(new Error("no loader")); return; }
    new THREE.GLTFLoader().load(encodeURI(name), g => { GLB[name] = g; res(g); }, undefined, e => { console.warn("glb load fail", name, e); rej(e); });
  });
}
function threeBegin() { initThree(); if (three) three.content.clear(); threeCanvas.classList.remove("hidden"); }
function threeRender() { if (three) three.renderer.render(three.scene, three.camera); }
function threeHide() { threeCanvas.classList.add("hidden"); }
// 모델을 target 크기로 맞추기 위한 정보(스케일/박스/중심) 반환
function fitModel(obj, target) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = target / Math.max(size.x, size.y, size.z);
  return { box, size, center, s };
}

// fx 캔버스(z3) 전용 그리기 헬퍼
function fxChain(pts, idxs) { ctxFx.beginPath(); idxs.forEach((i, k) => { const [x, y] = pts[i]; k ? ctxFx.lineTo(x, y) : ctxFx.moveTo(x, y); }); ctxFx.stroke(); }
function fxRound(x, y, w, h, r) { ctxFx.beginPath(); ctxFx.moveTo(x+r,y); ctxFx.arcTo(x+w,y,x+w,y+h,r); ctxFx.arcTo(x+w,y+h,x,y+h,r); ctxFx.arcTo(x,y+h,x,y,r); ctxFx.arcTo(x,y,x+w,y,r); ctxFx.closePath(); }
function fxHeart(cx, cy, sz) { ctxFx.beginPath(); ctxFx.moveTo(cx,cy+sz*0.3); ctxFx.bezierCurveTo(cx+sz,cy-sz*0.4,cx+sz*0.4,cy-sz*0.9,cx,cy-sz*0.3); ctxFx.bezierCurveTo(cx-sz*0.4,cy-sz*0.9,cx-sz,cy-sz*0.4,cx,cy+sz*0.3); ctxFx.closePath(); }
function fxDrawGloves() {
  const gcol = GAME.userCode ? getCountry(GAME.userCode).colors.glove : "#e63946";
  const dark = shade(gcol, -45), minWH = Math.min(W, H);
  const FINGERS = [[1,2,3,4],[5,6,7,8],[9,10,11,12],[13,14,15,16],[17,18,19,20]];
  for (const h of hands) {
    const pts = h.landmarks.map(p => [(1-p.x)*W, p.y*H]);
    const hr = h.r*minWH; if (hr < 4) continue;
    const fW = hr*0.42; ctxFx.lineCap = "round"; ctxFx.lineJoin = "round";
    for (const f of FINGERS) { ctxFx.strokeStyle = dark; ctxFx.lineWidth = fW*1.3; fxChain(pts, [0, ...f]); }
    for (const f of FINGERS) { ctxFx.strokeStyle = gcol; ctxFx.lineWidth = fW; fxChain(pts, [0, ...f]); }
    ctxFx.fillStyle = gcol; ctxFx.strokeStyle = dark; ctxFx.lineWidth = hr*0.08;
    ctxFx.beginPath(); [0,1,5,9,13,17].forEach((i,k)=>{const[x,y]=pts[i];k?ctxFx.lineTo(x,y):ctxFx.moveTo(x,y);}); ctxFx.closePath(); ctxFx.fill(); ctxFx.stroke();
    const wp = pts[0];
    ctxFx.fillStyle = "#fff"; ctxFx.beginPath(); ctxFx.arc(wp[0], wp[1], hr*0.28, 0, Math.PI*2); ctxFx.fill();
    ctxFx.fillStyle = gcol; ctxFx.beginPath(); ctxFx.arc(wp[0], wp[1], hr*0.16, 0, Math.PI*2); ctxFx.fill();
  }
}
function fxBubble(cx, baseY, text) {
  ctxFx.save();
  ctxFx.font = `bold ${Math.round(W*0.026)}px 'Segoe UI','Malgun Gothic',sans-serif`;
  const padX = W*0.02, padY = H*0.02, tw = ctxFx.measureText(text).width;
  const bw = tw + padX*2, bh = Math.round(W*0.026) + padY*2, x = cx - bw/2, y = baseY - bh;
  ctxFx.fillStyle = "rgba(255,255,255,0.97)"; ctxFx.strokeStyle = "#4ade80"; ctxFx.lineWidth = 3;
  fxRound(x, y, bw, bh, 14); ctxFx.fill(); ctxFx.stroke();
  ctxFx.beginPath(); ctxFx.moveTo(cx-12, y+bh-1); ctxFx.lineTo(cx, y+bh+18); ctxFx.lineTo(cx+12, y+bh-1);
  ctxFx.fillStyle = "rgba(255,255,255,0.97)"; ctxFx.fill(); ctxFx.strokeStyle = "#4ade80"; ctxFx.stroke();
  ctxFx.fillStyle = "#11151f"; ctxFx.textAlign = "center"; ctxFx.textBaseline = "middle";
  ctxFx.fillText(text, cx, y+bh/2); ctxFx.restore();
}

function startPetScene(table) {
  GAME.screen = "pet"; hudEl.classList.add("hidden"); uiEl.innerHTML = "";
  threeBegin(); fxCanvas.classList.remove("hidden");
  GAME.pet = { phase: "intro", timer: 0, t: 0, happy: 0, meter: 0, target: 2600, hearts: [], lastHands: {}, panelShown: false, table, dog: null, mixer: null, baseY: 0, loaded: false, err: false };
  three.camera.position.set(0, 0.8, 4.2); three.camera.lookAt(0, 0.45, 0); three.camera.updateProjectionMatrix();
  loadGLB("Shiba Inu.glb").then(g => {
    const dog = g.scene, f = fitModel(dog, 1.7);
    dog.scale.setScalar(f.s);
    dog.position.set(-f.center.x*f.s, -f.box.min.y*f.s - 0.7, -f.center.z*f.s);
    dog.rotation.set(0, Math.PI*0.08, 0);
    three.content.add(dog);
    GAME.pet.dog = dog; GAME.pet.baseY = dog.position.y; GAME.pet.loaded = true;
    if (g.animations && g.animations.length) { GAME.pet.mixer = new THREE.AnimationMixer(dog); GAME.pet.mixer.clipAction(g.animations[0]).play(); }
  }).catch(() => { GAME.pet.err = true; });
}
function endPetScene() { threeHide(); fxCanvas.classList.add("hidden"); ctxFx.clearRect(0, 0, W, H); }
function updatePet(dt) {
  const P = GAME.pet; P.timer += dt; P.t += dt;
  let petting = false;
  const cx = W*0.5, cy = H*0.55, rx = W*0.22, ry = H*0.28;
  for (const h of hands) {
    const hx = h.x*W, hy = h.y*H, L = P.lastHands[h.label] || { x: hx, y: hy };
    const sp = Math.hypot(hx - L.x, hy - L.y);
    P.lastHands[h.label] = { x: hx, y: hy };
    if (Math.abs(hx - cx) < rx && Math.abs(hy - cy) < ry && sp > 4) {
      petting = true;
      if (Math.random() < 0.4) P.hearts.push({ x: hx, y: hy - 10, vy: -1 - Math.random()*1.5, life: 1, s: 9 + Math.random()*12 });
    }
  }
  if (P.phase === "intro") { if (P.timer > 1400) { P.phase = "petting"; P.timer = 0; } }
  else if (P.phase === "petting") {
    if (petting) { P.meter += dt; P.happy = Math.min(1, P.happy + dt/600); }
    else P.happy = Math.max(0, P.happy - dt/900);
    if (P.meter >= P.target) { P.phase = "happy"; P.timer = 0; }
  } else if (P.phase === "happy") {
    P.happy = Math.min(1, P.happy + dt/300);
    if (P.timer > 2600) { P.phase = "done"; P.timer = 0; }
  } else if (P.phase === "done") {
    if (!P.panelShown && P.timer > 400) { P.panelShown = true; showPetPanel(); }
  }
  for (const h of P.hearts) { h.y += h.vy; h.life -= dt/900; }
  P.hearts = P.hearts.filter(h => h.life > 0);
  if (P.loaded && P.dog) {
    const tt = P.t/1000, wag = 0.5 + P.happy;
    P.dog.position.y = P.baseY + Math.abs(Math.sin(tt*4*wag)) * 0.10 * (0.4 + P.happy);
    P.dog.rotation.z = Math.sin(tt*9*wag) * 0.06 * P.happy;
    P.dog.rotation.y = Math.PI*0.08 + Math.sin(tt*2) * 0.12;
    if (P.mixer) P.mixer.update(dt/1000 * (1 + P.happy*1.5));
  }
}
function renderPet(dt) {
  const P = GAME.pet;
  drawStadium();
  ctx.fillStyle = "rgba(74,222,128,0.05)"; ctx.fillRect(0, 0, W, H*0.5);
  threeRender();
  ctxFx.clearRect(0, 0, W, H);
  fxDrawGloves();
  for (const h of P.hearts) { ctxFx.save(); ctxFx.globalAlpha = Math.max(0, h.life); ctxFx.fillStyle = "#fb7185"; fxHeart(h.x, h.y, h.s); ctxFx.fill(); ctxFx.restore(); }
  if (P.phase === "petting") {
    const bw = W*0.30, bx = W*0.5 - bw/2, by = H*0.16;
    ctxFx.fillStyle = "rgba(0,0,0,0.4)"; fxRound(bx, by, bw, 16, 8); ctxFx.fill();
    ctxFx.fillStyle = "#fb7185"; fxRound(bx, by, bw*Math.min(1, P.meter/P.target), 16, 8); ctxFx.fill();
  }
  if (P.err) {
    ctxFx.fillStyle = "#f87171"; ctxFx.textAlign = "center"; ctxFx.font = `bold ${Math.round(W*0.02)}px 'Segoe UI', sans-serif`;
    ctxFx.fillText("(강아지 모델을 못 불러왔어요 — 그래도 쓰담쓰담!)", W/2, H*0.9);
  } else if (!P.loaded) {
    ctxFx.fillStyle = "#cbd5e1"; ctxFx.textAlign = "center"; ctxFx.font = `bold ${Math.round(W*0.022)}px 'Segoe UI', sans-serif`;
    ctxFx.fillText("🐕 강아지 데려오는 중...", W/2, H*0.5);
  }
  let line = null;
  if (P.phase === "intro") line = "어? 강아지다! 🐕";
  else if (P.phase === "petting") line = P.happy > 0.5 ? "그래쪄~ 착하지 🐶" : "양손으로 쓰담쓰담 해주세요 🖐️";
  else line = "집에 가자 🐶❤️";
  fxBubble(W*0.5, H*0.32, line);
}
function showPetPanel() {
  const me = getCountry(GAME.userCode);
  const r = sortedTable().findIndex(t => t.code === GAME.userCode) + 1;
  endPetScene();
  show(`
    <div class="panel wide">
      <div class="cup">🐕❤️</div>
      <h1 style="color:#fbbf24">조 ${r}위 — 아쉽게 탈락…</h1>
      <p class="subtitle">${me.flag} ${me.name} — 하지만 강아지가 기다리고 있었어요. 쓰담쓰담 받고 신난 강아지와 함께 <b>집에 가자!</b> 🐶🏠</p>
      ${miniTable()}
      <button id="againBtn">처음으로 돌아갈까요? ↻</button>
    </div>`);
  document.getElementById("againBtn").onclick = () => { GAME.pet = null; showDifficultySelect(); };
}

// ============================================================
//  경기관리자: 순위별 엔딩 미리보기
// ============================================================
function adminFakeTable(rank) {
  if (!GAME.userCode) GAME.userCode = "KOR";
  initTable();
  const others = COUNTRIES.filter(c => c.code !== GAME.userCode).map(c => c.code);
  const order = []; let oi = 0;
  for (let r = 1; r <= 4; r++) order.push(r === rank ? GAME.userCode : others[oi++]);
  const pts = [9,6,3,1], w = [3,2,1,0], d = [0,0,0,1], l = [0,1,2,2], gf = [8,5,3,1], ga = [1,3,5,8];
  order.forEach((code, i) => {
    const t = GAME.table[code];
    t.pts = pts[i]; t.pld = 3; t.w = w[i]; t.d = d[i]; t.l = l[i]; t.gf = gf[i]; t.ga = ga[i];
  });
}
function showAdminPanel() {
  if (document.getElementById("adminPanel")) return;
  const d = document.createElement("div");
  d.id = "adminPanel"; d.className = "admin-overlay";
  d.innerHTML = `
    <div class="panel">
      <h2>🎬 결과 미리보기</h2>
      <p class="subtitle">최종 순위별 엔딩 컷신을 바로 확인할 수 있어요 (경기관리자)</p>
      <div class="admin-grid">
        <button class="rk1" data-r="1">🥇 1위<br><small>치킨 먹자 🍗</small></button>
        <button class="rk2" data-r="2">🥈 2위<br><small>동료들과 포옹 🤗</small></button>
        <button class="rk3" data-r="3">🥉 3위<br><small>강아지 쓰담쓰담 🐕</small></button>
        <button class="rk4" data-r="4">4위<br><small>경찰차 출동 🚓</small></button>
      </div>
      <button class="back" id="adminClose">닫기</button>
    </div>`;
  document.getElementById("stage").appendChild(d);
  d.querySelectorAll(".admin-grid button").forEach(b => b.onclick = () => adminPreviewRank(+b.dataset.r));
  d.querySelector("#adminClose").onclick = () => d.remove();
}
function adminPreviewRank(rank) {
  const p = document.getElementById("adminPanel"); if (p) p.remove();
  GAME.match = null;                       // 진행 중 경기 정리(미리보기 전용)
  adminFakeTable(rank);
  const table = sortedTable();
  if (rank === 1) startBeerScene(table);
  else if (rank === 2) startHighFiveScene(table);
  else if (rank === 3) startPetScene(table);
  else startPoliceScene(table);
}

// ============================================================
//  메인 루프
// ============================================================
let lastTime = 0;
function loop(t) {
  const dt = Math.min(50, t - lastTime || 16);
  lastTime = t;

  if (GAME.screen === "striker" && STRIKER) {
    updateStriker(dt);
    renderStriker(dt);
  } else if (GAME.screen === "play" && GAME.match) {
    updatePlay(dt);
    renderPlay();
  } else if (GAME.screen === "arrest" && GAME.arrest) {
    updateArrest(dt);
    renderArrest(dt);
  } else if (GAME.screen === "beer" && GAME.beer) {
    updateBeer(dt);
    renderBeer(dt);
  } else if (GAME.screen === "police" && GAME.police) {
    updatePolice(dt);
    renderPolice(dt);
  } else if (GAME.screen === "highfive" && GAME.highfive) {
    updateHighFive(dt);
    renderHighFive(dt);
  } else if (GAME.screen === "slap" && GAME.slap) {
    updateSlap(dt);
    renderSlap(dt);
  } else if (GAME.screen === "pet" && GAME.pet) {
    updatePet(dt);
    renderPet(dt);
  } else {
    // 메뉴 화면 배경 + (카메라 켜졌으면) 장갑 미리보기로 인식 확인
    drawStadium();
    updateParticles(dt);
    drawParticles();
    if (GAME.tracking) {
      const col = GAME.userCode ? getCountry(GAME.userCode).colors.glove : "#4ade80";
      drawGloves(col);
    }
  }
  updateTrackBadge();
  requestAnimationFrame(loop);
}

// 경기관리자 버튼 (언제나 결과 미리보기)
adminBtn.onclick = showAdminPanel;

// 공격수 변신 복귀 버튼 + ESC
strikerExitBtn.onclick = exitStrikerMode;
addEventListener("keydown", (e) => { if (e.key === "Escape" && GAME.screen === "striker") exitStrikerMode(); });

// 시작
showBoot();
requestAnimationFrame(loop);
