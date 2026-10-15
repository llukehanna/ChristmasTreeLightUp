/**
 * Home Alone's window figures (spec 2026-10-14 §3, §9): Harry and Marv as curved, jointed silhouettes, baked into sprites
 * once per layout (walk and sprint cycles, a crouch, a dive, Harry facing the room with and without his grin), Marv's
 * face and hands at the glass, the iron, the Oh-K Plumbing van, and the soft light sprites (flame, glint, glows, steam,
 * fog, the headlight beam). Nothing here runs per frame.
 */

type Ctx = CanvasRenderingContext2D;

/** A baked sprite: `k` device px per unit; the unit origin (a figure's feet) at (`ax`, `ay`) device px in `c`. */
export interface Sprite { c: HTMLCanvasElement; ax: number; ay: number; k: number }

export const SILHOUETTE = '#05070f';
/** Rim light: cold, from the moon and the snow behind them. */
export const RIM = 'rgba(190,210,255,.5)';
const TAU = Math.PI * 2;

let scratch: HTMLCanvasElement | null = null;

/**
 * Bakes `paint` (units: origin at the feet, y down, drawn with fill() and stroke() in whatever style is set) over the
 * box [x0, x1]×[y0, y1] plus `pad` units all round, at `k` device px per unit: the silhouette in `color`, a soft `glow`
 * behind its outline (its blurred shadow, from one copy drawn off the canvas), then `detail` over it (same transform).
 */
export function bake(
  k: number, box: readonly [number, number, number, number], pad: number, paint: (x: Ctx) => void,
  color: string | null = SILHOUETTE, glow: string | null = RIM, detail?: (x: Ctx) => void,
): Sprite | null {
  const [x0, y0, x1, y1] = box;
  const w = Math.max(2, Math.ceil((x1 - x0 + 2 * pad) * k));
  const h = Math.max(2, Math.ceil((y1 - y0 + 2 * pad) * k));
  const ax = (pad - x0) * k;
  const ay = (pad - y0) * k;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  if (!x) return null;
  if (color) {
    scratch ??= document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const s = scratch.getContext('2d');
    if (!s) return null;
    s.setTransform(k, 0, 0, k, ax, ay);
    s.fillStyle = color;
    s.strokeStyle = color;
    s.lineCap = 'round';
    s.lineJoin = 'round';
    paint(s);
    if (glow) {
      const off = w + 16;
      x.shadowColor = glow;
      x.shadowBlur = 0.6 * pad * k;
      x.shadowOffsetX = off;
      x.drawImage(scratch, -off, 0);
      x.shadowColor = 'rgba(0,0,0,0)';
      x.shadowBlur = 0;
      x.shadowOffsetX = 0;
    }
    x.drawImage(scratch, 0, 0);
    scratch.width = scratch.height = 1;
  }
  x.setTransform(k, 0, 0, k, ax, ay);
  x.lineCap = 'round';
  x.lineJoin = 'round';
  detail?.(x);
  return { c, ax, ay, k };
}

/* ---------- the rig: a profile figure facing +x, 1 unit tall, feet at the origin ---------- */

interface Rig {
  thigh: number; shin: number; thighW: number; shinW: number; footL: number; footH: number;
  /** Shoulder joint, from the hip, in the body's (leaning) frame. */
  shX: number; shY: number;
  upper: number; fore: number; upperW: number; foreW: number; hand: number;
  /** Torso, head and hat in the body frame (origin at the hip, y down). */
  body(x: Ctx): void;
  /** Top of the hat, body frame: where a flame sits. */
  top: readonly [number, number];
}

/** Joint angles. Legs and arms from straight down, + forward; knees bend back (`k`), elbows forward (`e`). `lean`: the body, + forward. */
export interface Pose { lean: number; hA: number; kA: number; hB: number; kB: number; aA: number; eA: number; aB: number; eB: number }

const HARRY: Rig = {
  thigh: 0.2, shin: 0.195, thighW: 0.09, shinW: 0.07, footL: 0.09, footH: 0.032,
  shX: 0, shY: -0.29, upper: 0.165, fore: 0.15, upperW: 0.072, foreW: 0.06, hand: 0.035,
  top: [0, -0.575],
  body(x) {
    // A heavy coat over a belly: rounded shoulders, a turned-up collar, a flared hem.
    x.beginPath();
    x.moveTo(0.045, -0.335);
    x.quadraticCurveTo(0.12, -0.315, 0.128, -0.22);
    x.quadraticCurveTo(0.172, -0.12, 0.135, 0.03);
    x.lineTo(0.128, 0.062);
    x.quadraticCurveTo(0, 0.08, -0.13, 0.058);
    x.quadraticCurveTo(-0.118, -0.12, -0.112, -0.22);
    x.quadraticCurveTo(-0.118, -0.31, -0.06, -0.338);
    x.quadraticCurveTo(-0.01, -0.362, 0.045, -0.335);
    x.fill();
    x.beginPath();
    x.ellipse(-0.035, -0.35, 0.05, 0.035, -0.3, 0, TAU); // collar
    x.fill();
    x.beginPath();
    x.ellipse(0.012, -0.345, 0.05, 0.04, 0, 0, TAU); // neck
    x.fill();
    // The head: round, a heavy jaw, a bulb of a nose.
    x.beginPath();
    x.ellipse(0.012, -0.415, 0.07, 0.08, 0, 0, TAU);
    x.fill();
    x.beginPath();
    x.ellipse(0.034, -0.372, 0.052, 0.04, 0.2, 0, TAU);
    x.fill();
    x.beginPath();
    x.ellipse(0.079, -0.41, 0.022, 0.019, 0.3, 0, TAU);
    x.fill();
    // A short-brimmed hat, the crown pinched.
    x.beginPath();
    x.ellipse(0.008, -0.478, 0.13, 0.018, -0.07, 0, TAU);
    x.fill();
    x.beginPath();
    x.moveTo(-0.072, -0.474);
    x.bezierCurveTo(-0.078, -0.54, -0.062, -0.578, -0.02, -0.572);
    x.quadraticCurveTo(0.004, -0.56, 0.026, -0.574);
    x.bezierCurveTo(0.066, -0.58, 0.074, -0.54, 0.07, -0.482);
    x.closePath();
    x.fill();
  },
};

const MARV: Rig = {
  thigh: 0.255, shin: 0.245, thighW: 0.058, shinW: 0.047, footL: 0.078, footH: 0.025,
  shX: 0, shY: -0.27, upper: 0.2, fore: 0.185, upperW: 0.052, foreW: 0.044, hand: 0.028,
  top: [0, -0.49],
  body(x) {
    // A thin man in a short jacket, a long neck, a big nose, a knit cap.
    // A stooped back, a short jacket flaring a little at the hem.
    x.beginPath();
    x.moveTo(0.03, -0.302);
    x.quadraticCurveTo(0.08, -0.284, 0.077, -0.2);
    x.quadraticCurveTo(0.07, -0.06, 0.074, 0.038);
    x.quadraticCurveTo(0, 0.056, -0.078, 0.036);
    x.quadraticCurveTo(-0.08, -0.12, -0.082, -0.23);
    x.quadraticCurveTo(-0.082, -0.3, -0.04, -0.312);
    x.quadraticCurveTo(0, -0.326, 0.03, -0.302);
    x.fill();
    x.beginPath();
    x.ellipse(0.004, -0.33, 0.029, 0.046, 0.15, 0, TAU); // neck
    x.fill();
    x.beginPath();
    x.ellipse(0.008, -0.39, 0.047, 0.058, 0, 0, TAU);
    x.fill();
    x.beginPath();
    x.ellipse(0.026, -0.352, 0.035, 0.03, 0.25, 0, TAU); // jaw
    x.fill();
    x.beginPath();
    x.ellipse(0.06, -0.374, 0.027, 0.015, 0.75, 0, TAU); // a long nose, drooping
    x.fill();
    x.beginPath();
    x.moveTo(-0.058, -0.402);
    x.bezierCurveTo(-0.072, -0.458, -0.03, -0.494, 0.008, -0.492);
    x.bezierCurveTo(0.05, -0.49, 0.066, -0.452, 0.058, -0.414);
    x.quadraticCurveTo(0, -0.432, -0.058, -0.402);
    x.fill();
  },
};

/** Where the hat's top and the hip ended up in the last figure drawn (units, feet at the origin, before any mirroring). */
const lastTop: [number, number] = [0, 0];

function limb(x: Ctx, ax: number, ay: number, len1: number, a1: number, w1: number, len2: number, a2: number, w2: number): [number, number] {
  const bx = ax + len1 * Math.sin(a1);
  const by = ay + len1 * Math.cos(a1);
  const cx = bx + len2 * Math.sin(a2);
  const cy = by + len2 * Math.cos(a2);
  x.lineWidth = w1;
  x.beginPath();
  x.moveTo(ax, ay);
  x.lineTo(bx, by);
  x.stroke();
  x.lineWidth = w2;
  x.beginPath();
  x.moveTo(bx, by);
  x.lineTo(cx, cy);
  x.stroke();
  return [cx, cy];
}

/** One profile figure in a pose; its lower ankle on the ground, so the hips ride up and down through a stride by themselves. */
function figure(x: Ctx, r: Rig, p: Pose): void {
  const ankleY = (h: number, k: number) => r.thigh * Math.cos(h) + r.shin * Math.cos(h - k);
  const hipY = -Math.max(ankleY(p.hA, p.kA), ankleY(p.hB, p.kB)) - 0.55 * r.footH;
  const leg = (h: number, k: number) => {
    const [ax, ay] = limb(x, 0, hipY, r.thigh, h, r.thighW, r.shin, h - k, r.shinW);
    // The shoe: toe down as the leg trails, up as it reaches.
    x.beginPath();
    const rot = -(h - k) * 0.7;
    x.ellipse(ax + 0.35 * r.footL * Math.cos(rot), ay + 0.35 * r.footL * Math.sin(rot), 0.6 * r.footL, r.footH, rot, 0, TAU);
    x.fill();
  };
  const arm = (a: number, e: number) => {
    const [hx, hy] = limb(x, r.shX, r.shY, r.upper, a, r.upperW, r.fore, a + e, r.foreW);
    x.beginPath();
    x.arc(hx + 0.3 * r.hand * Math.sin(a + e), hy + 0.3 * r.hand * Math.cos(a + e), r.hand, 0, TAU);
    x.fill();
  };
  leg(p.hB, p.kB);
  x.translate(0, hipY);
  x.rotate(p.lean);
  arm(p.aB, p.eB);
  r.body(x);
  arm(p.aA, p.eA);
  x.rotate(-p.lean);
  x.translate(0, -hipY);
  leg(p.hA, p.kA);
  const c = Math.cos(p.lean);
  const s = Math.sin(p.lean);
  lastTop[0] = c * r.top[0] - s * r.top[1];
  lastTop[1] = hipY + s * r.top[0] + c * r.top[1];
}

/** A walk cycle at phase `ph` (rad): 0 is the passing pose, legs together. `creep` bends the knees and the back. */
function walkPose(ph: number, amp: number, arms: number, creep: number, out: Pose): Pose {
  const set = (q: number, leg: 'A' | 'B') => {
    const h = amp * Math.sin(q);
    const k = 0.08 + creep + 0.62 * Math.max(0, Math.cos(q)) ** 2;
    const a = -arms * Math.sin(q);
    const e = 0.25 + 0.4 * Math.max(0, -Math.sin(q));
    if (leg === 'A') Object.assign(out, { hA: h, kA: k, aA: a, eA: e });
    else Object.assign(out, { hB: h, kB: k, aB: a, eB: e });
  };
  set(ph, 'A');
  set(ph + Math.PI, 'B');
  out.lean = 0.06 + creep * 0.5;
  return out;
}

/** Harry flat out, arms up beating at the fire on his hat. */
function sprintPose(ph: number, out: Pose): Pose {
  for (const [q, leg] of [[ph, 'A'], [ph + Math.PI, 'B']] as const) {
    const h = 0.78 * Math.sin(q);
    const k = 0.25 + 1.5 * Math.max(0, Math.cos(q - 0.4)) ** 1.5;
    if (leg === 'A') Object.assign(out, { hA: h, kA: k });
    else Object.assign(out, { hB: h, kB: k });
  }
  out.aA = 2.55 + 0.45 * Math.sin(2 * ph);
  out.eA = 0.55 + 0.45 * Math.sin(2 * ph + 1);
  out.aB = 2.85 + 0.4 * Math.sin(2 * ph + 2.2);
  out.eB = 0.7 + 0.4 * Math.sin(2 * ph + 3);
  out.lean = 0.34;
  return out;
}

const STAND: Pose = { lean: 0.04, hA: 0.05, kA: 0.06, hB: -0.04, kB: 0.05, aA: 0.06, eA: 0.18, aB: -0.04, eB: 0.15 };
/** Down on his haunches before the dive, arms swung back: the anticipation. */
const CROUCH: Pose = { lean: 0.62, hA: 0.95, kA: 1.6, hB: 0.1, kB: 1.25, aA: -1.1, eA: 0.2, aB: -0.85, eB: 0.25 };
/** Stretched out head first, arms over his head. */
const DIVE: Pose = { lean: 0, hA: -0.12, kA: 0.12, hB: -0.28, kB: 0.3, aA: 3.0, eA: 0.04, aB: 2.88, eB: 0.08 };

export const WALK_FRAMES = 8;
export const SPRINT_FRAMES = 8;
/** One stride cycle (two steps), in the figure's heights. */
export const HARRY_CYCLE = 0.62;
export const MARV_CYCLE = 0.66;
export const SPRINT_CYCLE = 1.25;
/** Where the dive pivots, units above the feet: his middle. */
export const DIVE_PIVOT = 0.5;

/** Room round each figure's box for its rim glow, in its heights. */
const PAD = 0.12;

export interface FigureSprites {
  harryWalk: Sprite[];
  marvWalk: Sprite[];
  harryStand: Sprite | null;
  marvStand: Sprite | null;
  harrySprint: Sprite[];
  harryCrouch: Sprite | null;
  harryDive: Sprite | null;
  harryFront: Sprite | null;
  harryGrin: Sprite | null;
  /** Hat tops (units from the feet) for the sprint frames, then the crouch, then the dive. */
  sprintTops: Float32Array;
  /** The gold tooth on the grinning sprite (units from the feet). */
  tooth: readonly [number, number];
}

const pose = (): Pose => ({ lean: 0, hA: 0, kA: 0, hB: 0, kB: 0, aA: 0, eA: 0, aB: 0, eB: 0 });
const WALK_BOX = (aspect: number) => [-aspect / 2, -1.02, aspect / 2, 0.01] as const;
const SPRINT_BOX = [-0.5, -1.12, 0.5, 0.01] as const;
const DIVE_BOX = [-0.3, -1.3, 0.3, 0.01] as const;

/** Every figure sprite, `hk` and `mk` device px per Harry's and Marv's height. */
export function bakeFigures(hk: number, mk: number, harryAspect: number, marvAspect: number): FigureSprites {
  const p = pose();
  const out: FigureSprites = {
    harryWalk: [], marvWalk: [], harryStand: null, marvStand: null, harrySprint: [], harryCrouch: null, harryDive: null,
    harryFront: null, harryGrin: null, sprintTops: new Float32Array(2 * (SPRINT_FRAMES + 2)), tooth: [0.014, -0.793],
  };
  for (let f = 0; f < WALK_FRAMES; f++) {
    const ph = (f / WALK_FRAMES) * TAU;
    const h = bake(hk, WALK_BOX(harryAspect), PAD, (x) => figure(x, HARRY, walkPose(ph, 0.42, 0.42, 0.04, p)));
    const m = bake(mk, WALK_BOX(marvAspect), PAD, (x) => figure(x, MARV, walkPose(ph, 0.33, 0.3, 0.14, p)));
    if (h) out.harryWalk.push(h);
    if (m) out.marvWalk.push(m);
  }
  out.harryStand = bake(hk, WALK_BOX(harryAspect), PAD, (x) => figure(x, HARRY, STAND));
  out.marvStand = bake(mk, WALK_BOX(marvAspect), PAD, (x) => figure(x, MARV, { ...STAND, lean: 0.12, kA: 0.18, kB: 0.16 }));
  for (let f = 0; f < SPRINT_FRAMES; f++) {
    const s = bake(hk, SPRINT_BOX, PAD, (x) => figure(x, HARRY, sprintPose((f / SPRINT_FRAMES) * TAU, p)));
    out.sprintTops[2 * f] = lastTop[0];
    out.sprintTops[2 * f + 1] = lastTop[1];
    if (s) out.harrySprint.push(s);
  }
  out.harryCrouch = bake(hk, SPRINT_BOX, PAD, (x) => figure(x, HARRY, CROUCH));
  out.sprintTops[2 * SPRINT_FRAMES] = lastTop[0];
  out.sprintTops[2 * SPRINT_FRAMES + 1] = lastTop[1];
  out.harryDive = bake(hk, DIVE_BOX, PAD, (x) => figure(x, HARRY, DIVE));
  out.sprintTops[2 * SPRINT_FRAMES + 2] = lastTop[0];
  out.sprintTops[2 * SPRINT_FRAMES + 3] = lastTop[1];
  out.harryFront = bake(hk, WALK_BOX(harryAspect), PAD, harryFront, SILHOUETTE, RIM, (x) => roomLight(x, false));
  out.harryGrin = bake(hk, WALK_BOX(harryAspect), PAD, harryFront, SILHOUETTE, RIM, (x) => roomLight(x, true));
  return out;
}

/** Harry square on to the room: sloped shoulders, a heavy coat flaring at the hem, arms hanging clear of it, the hat. */
function harryFront(x: Ctx): void {
  x.beginPath();
  x.moveTo(-0.045, -0.758);
  x.quadraticCurveTo(-0.13, -0.752, -0.158, -0.7);
  x.quadraticCurveTo(-0.176, -0.66, -0.165, -0.6);
  x.quadraticCurveTo(-0.15, -0.52, -0.152, -0.47);
  x.quadraticCurveTo(-0.16, -0.4, -0.175, -0.345);
  x.quadraticCurveTo(0, -0.325, 0.175, -0.345);
  x.quadraticCurveTo(0.16, -0.4, 0.152, -0.47);
  x.quadraticCurveTo(0.15, -0.52, 0.165, -0.6);
  x.quadraticCurveTo(0.176, -0.66, 0.158, -0.7);
  x.quadraticCurveTo(0.13, -0.752, 0.045, -0.758);
  x.closePath();
  x.fill();
  for (const s of [-1, 1]) {
    // Arms out a little from the coat, gloved hands at his thighs.
    limb(x, s * 0.152, -0.69, 0.165, -s * 0.08, 0.07, 0.15, s * 0.03, 0.06);
    x.beginPath();
    x.ellipse(s * 0.162, -0.39, 0.03, 0.038, -s * 0.1, 0, TAU);
    x.fill();
    // Legs apart, a little taper, shoes turned out.
    limb(x, s * 0.068, -0.37, 0.18, s * 0.03, 0.088, 0.175, s * 0.01, 0.068);
    x.beginPath();
    x.ellipse(s * 0.088, -0.018, 0.05, 0.024, s * 0.3, 0, TAU);
    x.fill();
  }
  x.beginPath();
  x.ellipse(0, -0.765, 0.045, 0.04, 0, 0, TAU); // neck
  x.fill();
  x.beginPath();
  x.ellipse(0, -0.835, 0.07, 0.082, 0, 0, TAU);
  x.fill();
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(s * 0.07, -0.83, 0.016, 0.026, 0, 0, TAU); // ears
    x.fill();
  }
  x.beginPath();
  x.ellipse(0, -0.898, 0.14, 0.02, 0, 0, TAU);
  x.fill();
  x.beginPath();
  x.moveTo(-0.075, -0.894);
  x.bezierCurveTo(-0.08, -0.96, -0.06, -0.998, -0.02, -0.99);
  x.quadraticCurveTo(0, -0.98, 0.02, -0.99);
  x.bezierCurveTo(0.06, -0.998, 0.08, -0.96, 0.075, -0.894);
  x.closePath();
  x.fill();
}

/** The room's warm light on Harry's face as he turns to it, and (grinning) his teeth and the gold one. */
function roomLight(x: Ctx, grin: boolean): void {
  x.globalCompositeOperation = 'source-atop';
  const g = x.createRadialGradient(0, -0.81, 0, 0, -0.81, 0.11);
  g.addColorStop(0, 'rgba(255,200,150,.12)');
  g.addColorStop(1, 'rgba(255,200,150,0)');
  x.fillStyle = g;
  x.fillRect(-0.2, -0.95, 0.4, 0.3);
  // The coat's front opening, catching a little of the room's light.
  x.strokeStyle = 'rgba(150,140,130,.16)';
  x.lineWidth = 0.008;
  x.beginPath();
  x.moveTo(-0.04, -0.75);
  x.lineTo(0, -0.62);
  x.lineTo(0.04, -0.75);
  x.moveTo(0, -0.62);
  x.lineTo(0, -0.34);
  x.stroke();
  x.globalCompositeOperation = 'source-over';
  // Two glints of eye.
  x.fillStyle = 'rgba(255,236,210,.55)';
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(s * 0.026, -0.85, 0.009, grin ? 0.005 : 0.007, 0, 0, TAU);
    x.fill();
  }
  if (!grin) return;
  // A wide grin: a crescent of teeth, one of them gold.
  x.fillStyle = 'rgba(244,232,212,.85)';
  x.beginPath();
  x.moveTo(-0.04, -0.8);
  x.quadraticCurveTo(0, -0.792, 0.04, -0.8);
  x.quadraticCurveTo(0, -0.765, -0.04, -0.8);
  x.fill();
  x.fillStyle = '#ffc93c';
  x.beginPath();
  x.ellipse(0.014, -0.791, 0.008, 0.007, 0, 0, TAU);
  x.fill();
}

/* ---------- the iron and its cord ---------- */

/** A clothes iron, sole down, its point to the left: 1 unit tall, ~1.5 long, the sole's middle at the origin. */
export function bakeIron(k: number): Sprite | null {
  return bake(k, [-0.8, -1, 0.8, 0.02], 0.25, (x) => {
    x.beginPath();
    x.moveTo(-0.78, 0);
    x.bezierCurveTo(-0.5, -0.3, -0.1, -0.5, 0.5, -0.5);
    x.quadraticCurveTo(0.72, -0.48, 0.72, -0.3);
    x.lineTo(0.72, -0.06);
    x.quadraticCurveTo(0.72, 0, 0.64, 0);
    x.closePath();
    x.fill();
    x.lineWidth = 0.12;
    x.beginPath();
    x.moveTo(-0.22, -0.38);
    x.quadraticCurveTo(-0.16, -0.9, 0.1, -0.9);
    x.lineTo(0.4, -0.9);
    x.quadraticCurveTo(0.52, -0.9, 0.5, -0.5);
    x.stroke();
  });
}

/* ---------- Marv at the glass ---------- */

/**
 * Marv's face pressed to the glass, 1 unit = his face (cap top −0.5 to chin +0.5), its centre at the origin: the cap, the
 * ears, the neck fading off below; the room's light on the squashed nose (nostrils showing), the flattened lips and cheeks.
 */
export function bakeMarvFace(k: number): Sprite | null {
  return bake(k, [-0.5, -0.52, 0.5, 0.66], 0.1, (x) => {
    x.beginPath();
    x.moveTo(0, -0.5);
    x.bezierCurveTo(0.24, -0.5, 0.36, -0.36, 0.36, -0.14);
    x.bezierCurveTo(0.37, 0.12, 0.33, 0.3, 0.2, 0.42);
    x.quadraticCurveTo(0.1, 0.5, 0, 0.5);
    x.quadraticCurveTo(-0.1, 0.5, -0.2, 0.42);
    x.bezierCurveTo(-0.33, 0.3, -0.37, 0.12, -0.36, -0.14);
    x.bezierCurveTo(-0.36, -0.36, -0.24, -0.5, 0, -0.5);
    x.fill();
    for (const s of [-1, 1]) {
      x.beginPath();
      x.ellipse(s * 0.36, 0.04, 0.06, 0.1, s * 0.2, 0, TAU);
      x.fill();
    }
    x.beginPath();
    x.moveTo(-0.15, 0.36);
    x.quadraticCurveTo(-0.16, 0.5, -0.2, 0.6);
    x.lineTo(0.2, 0.6);
    x.quadraticCurveTo(0.16, 0.5, 0.15, 0.36);
    x.fill();
  }, SILHOUETTE, RIM, (x) => {
    // The neck fades into the dark below.
    x.globalCompositeOperation = 'destination-out';
    const fade = x.createLinearGradient(0, 0.4, 0, 0.6);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    x.fillStyle = fade;
    x.fillRect(-0.7, 0.4, 1.4, 0.4);
    x.globalCompositeOperation = 'source-atop';
    // The cap: a folded cuff, the knit's ribs catching the light.
    x.fillStyle = '#0b0e1a';
    x.beginPath();
    x.moveTo(-0.37, -0.12);
    x.bezierCurveTo(-0.37, -0.42, -0.22, -0.52, 0, -0.52);
    x.bezierCurveTo(0.22, -0.52, 0.37, -0.42, 0.37, -0.12);
    x.quadraticCurveTo(0, -0.17, -0.37, -0.12);
    x.fill();
    x.strokeStyle = 'rgba(150,170,210,.12)';
    x.lineWidth = 0.012;
    for (let k = -6; k <= 6; k++) {
      x.beginPath();
      x.moveTo(k * 0.05, -0.27 + Math.abs(k) * 0.004);
      x.lineTo(k * 0.052, -0.15 + Math.abs(k) * 0.006);
      x.stroke();
    }
    x.strokeStyle = 'rgba(150,170,210,.18)';
    x.lineWidth = 0.014;
    x.beginPath();
    x.moveTo(-0.36, -0.28);
    x.quadraticCurveTo(0, -0.33, 0.36, -0.28);
    x.stroke();
    x.globalCompositeOperation = 'source-over';
    // Glints of eye, wide.
    x.fillStyle = 'rgba(255,240,220,.6)';
    for (const s of [-1, 1]) {
      x.beginPath();
      x.ellipse(s * 0.13, -0.04, 0.02, 0.014, 0, 0, TAU);
      x.fill();
    }
    // Pressed flat to the glass: pale where skin meets it.
    const patch = (cx: number, cy: number, rx: number, ry: number, a: number) => {
      const g = x.createRadialGradient(cx, cy, 0, cx, cy, 1);
      g.addColorStop(0, `rgba(222,214,220,${a})`);
      g.addColorStop(0.6, `rgba(222,214,220,${a * 0.7})`);
      g.addColorStop(1, 'rgba(222,214,220,0)');
      x.save();
      x.translate(cx, cy);
      x.scale(rx, ry);
      x.translate(-cx, -cy);
      x.fillStyle = g;
      x.beginPath();
      x.arc(cx, cy, 1, 0, TAU);
      x.fill();
      x.restore();
    };
    patch(0, 0.13, 0.12, 0.08, 0.5);
    patch(0, 0.31, 0.12, 0.04, 0.3);
    // The nostrils of a nose squashed flat, and the mouth's line.
    x.fillStyle = 'rgba(6,8,16,.9)';
    for (const s of [-1, 1]) {
      x.beginPath();
      x.ellipse(s * 0.035, 0.14, 0.022, 0.016, s * -0.3, 0, TAU);
      x.fill();
    }
    x.strokeStyle = 'rgba(6,8,16,.7)';
    x.lineWidth = 0.014;
    x.beginPath();
    x.moveTo(-0.1, 0.31);
    x.quadraticCurveTo(0, 0.322, 0.1, 0.31);
    x.stroke();
  });
}

/** A gloved hand flat on the glass, fingers up and spread, the thumb to the left (mirror it for the right): 1 unit tall. */
export function bakeMarvHand(k: number): Sprite | null {
  const FINGERS = [[-0.13, 0.36, -0.2], [-0.045, 0.43, -0.07], [0.045, 0.41, 0.05], [0.13, 0.32, 0.17]] as const;
  const paint = (x: Ctx) => {
    x.beginPath();
    x.moveTo(-0.18, 0.02);
    x.quadraticCurveTo(-0.2, 0.22, -0.13, 0.33);
    x.lineTo(0.12, 0.33);
    x.quadraticCurveTo(0.2, 0.22, 0.18, 0.0);
    x.quadraticCurveTo(0, -0.06, -0.18, 0.02);
    x.fill();
    x.lineWidth = 0.088;
    for (const [bx, len, a] of FINGERS) {
      x.beginPath();
      x.moveTo(bx, 0.04);
      x.lineTo(bx + len * Math.sin(a), 0.04 - len * Math.cos(a));
      x.stroke();
    }
    x.lineWidth = 0.1;
    x.beginPath();
    x.moveTo(-0.14, 0.24);
    x.quadraticCurveTo(-0.28, 0.2, -0.36, 0.06);
    x.stroke();
    x.lineWidth = 0.24;
    x.beginPath();
    x.moveTo(0, 0.34);
    x.lineTo(0.01, 0.5);
    x.stroke();
  };
  return bake(k, [-0.45, -0.45, 0.3, 0.56], 0.08, paint, SILHOUETTE, RIM, (x) => {
    // Pale only where the palm and the fingertips press on the glass.
    x.globalCompositeOperation = 'source-atop';
    const g = x.createRadialGradient(0, 0.17, 0, 0, 0.17, 0.2);
    g.addColorStop(0, 'rgba(222,214,220,.2)');
    g.addColorStop(1, 'rgba(222,214,220,0)');
    x.fillStyle = g;
    x.fillRect(-0.4, -0.1, 0.8, 0.5);
    x.fillStyle = 'rgba(222,214,220,.16)';
    for (const [bx, len, a] of FINGERS) {
      x.beginPath();
      x.ellipse(bx + 0.88 * len * Math.sin(a), 0.04 - 0.88 * len * Math.cos(a), 0.034, 0.045, a, 0, TAU);
      x.fill();
    }
    x.globalCompositeOperation = 'source-over';
  });
}

/* ---------- the van ---------- */

/** Van units: 1 = its height (tyres to roof), ~2.45 long, rear at x 0, the front (+x) to the right, the road at y 0. */
export const VAN_LEN = 2.45;
export const VAN_WHEELS = [0.52, 1.92] as const;
export const VAN_HEADLIGHT = [2.42, -0.42] as const;
export const VAN_TAIL = [0.03, -0.55] as const;

/** A 1990 panel van, side on: a long box, a short sloped hood, wheel arches, the lettering only suggested. */
export function bakeVan(k: number): Sprite | null {
  const body = (x: Ctx) => {
    const [r0, r1] = VAN_WHEELS;
    const arch = 0.235;
    x.beginPath();
    x.moveTo(0.02, -0.2);
    x.lineTo(0.02, -0.92);
    x.quadraticCurveTo(0.02, -1, 0.1, -1);
    x.lineTo(1.84, -1);
    x.quadraticCurveTo(1.93, -1, 1.97, -0.93);
    x.lineTo(2.18, -0.64);
    x.quadraticCurveTo(2.2, -0.61, 2.25, -0.6);
    x.lineTo(2.38, -0.58);
    x.quadraticCurveTo(2.45, -0.56, 2.45, -0.48);
    x.lineTo(2.45, -0.22);
    x.quadraticCurveTo(2.45, -0.18, 2.4, -0.18);
    x.lineTo(r1 + arch, -0.18);
    x.arc(r1, -0.17, arch, 0, Math.PI, true);
    x.lineTo(r0 + arch, -0.18);
    x.arc(r0, -0.17, arch, 0, Math.PI, true);
    x.lineTo(0.06, -0.18);
    x.quadraticCurveTo(0.02, -0.18, 0.02, -0.2);
    x.closePath();
    x.fill();
    for (const w of VAN_WHEELS) {
      x.beginPath();
      x.arc(w, -0.17, 0.175, 0, TAU);
      x.fill();
    }
    // A plumber's ladder on the roof rack.
    x.lineWidth = 0.035;
    x.beginPath();
    x.moveTo(0.18, -1.08);
    x.lineTo(1.62, -1.08);
    for (const r of [0.3, 0.95, 1.5]) {
      x.moveTo(r, -1.08);
      x.lineTo(r, -0.99);
    }
    x.stroke();
  };
  return bake(k, [0, -1.12, VAN_LEN, 0.01], 0.12, body, '#121a2e', 'rgba(170,190,240,.35)', (x) => {
    x.globalCompositeOperation = 'source-atop';
    // Moonlight along the roof, falling off down the side.
    const sheen = x.createLinearGradient(0, -1, 0, -0.2);
    sheen.addColorStop(0, 'rgba(170,190,235,.28)');
    sheen.addColorStop(0.18, 'rgba(170,190,235,.06)');
    sheen.addColorStop(1, 'rgba(0,0,0,.25)');
    x.fillStyle = sheen;
    x.fillRect(0, -1.05, VAN_LEN, 0.9);
    x.globalCompositeOperation = 'source-over';
    // The tyres, darker in their arches, with a hub's glint.
    for (const w of VAN_WHEELS) {
      x.fillStyle = '#04060c';
      x.beginPath();
      x.arc(w, -0.17, 0.165, 0, TAU);
      x.fill();
      x.strokeStyle = 'rgba(150,165,200,.28)';
      x.lineWidth = 0.025;
      x.beginPath();
      x.arc(w, -0.17, 0.07, 0, TAU);
      x.stroke();
    }
    // The cab's side window and the windscreen's edge, with a cold reflection.
    const glass = x.createLinearGradient(1.6, -0.95, 1.95, -0.6);
    glass.addColorStop(0, 'rgba(120,145,200,.32)');
    glass.addColorStop(1, 'rgba(40,52,84,.5)');
    x.fillStyle = glass;
    x.beginPath();
    x.moveTo(1.62, -0.9);
    x.lineTo(1.88, -0.9);
    x.lineTo(2.08, -0.64);
    x.lineTo(1.62, -0.64);
    x.closePath();
    x.fill();
    // Panel seams: the cab door and the sliding door.
    x.strokeStyle = 'rgba(0,0,0,.45)';
    x.lineWidth = 0.02;
    x.beginPath();
    x.moveTo(1.58, -0.94);
    x.lineTo(1.58, -0.22);
    x.moveTo(1.14, -0.94);
    x.lineTo(1.14, -0.22);
    x.stroke();
    // OH-K PLUMBING, only suggested: a fat word and a thin one, too small and soft to read.
    x.strokeStyle = 'rgba(232,214,170,.34)';
    x.lineWidth = 0.075;
    x.beginPath();
    for (const [a, b] of [[0.22, 0.34], [0.4, 0.46], [0.52, 0.66], [0.72, 0.84]] as const) {
      x.moveTo(a, -0.66);
      x.lineTo(b, -0.66);
    }
    x.stroke();
    x.lineWidth = 0.035;
    x.beginPath();
    x.moveTo(0.22, -0.5);
    x.lineTo(1.0, -0.5);
    x.stroke();
    // The bumper's chrome edge.
    x.strokeStyle = 'rgba(170,185,215,.3)';
    x.lineWidth = 0.03;
    x.beginPath();
    x.moveTo(2.2, -0.25);
    x.lineTo(2.44, -0.25);
    x.stroke();
  });
}

/* ---------- soft light ---------- */

/** A round soft sprite `px` device px across from colour stops [offset, css colour]; units: radius 1 about the middle. */
export function bakeSoft(px: number, stops: readonly (readonly [number, string])[]): Sprite | null {
  const k = Math.max(4, Math.round(px / 2));
  return bake(k, [-1, -1, 1, 1], 0, () => {}, null, null, (x) => {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    x.fillStyle = g;
    x.fillRect(-1, -1, 2, 2);
  });
}

/** A flame tongue, base at the origin, tip up at y −1 (units: its height), filled soft from `core` out to nothing. */
export function bakeFlame(px: number, core: string, mid: string, edge: string): Sprite | null {
  const k = Math.max(4, Math.round(px));
  return bake(k, [-0.42, -1.02, 0.42, 0.22], 0.04, () => {}, null, null, (x) => {
    x.beginPath();
    x.moveTo(0, -1);
    x.bezierCurveTo(0.12, -0.7, 0.42, -0.42, 0.36, -0.1);
    x.bezierCurveTo(0.32, 0.12, 0.12, 0.2, 0, 0.2);
    x.bezierCurveTo(-0.12, 0.2, -0.32, 0.12, -0.36, -0.1);
    x.bezierCurveTo(-0.42, -0.42, -0.12, -0.7, 0, -1);
    x.closePath();
    x.clip();
    const g = x.createRadialGradient(0, 0.02, 0, 0, -0.2, 0.85);
    g.addColorStop(0, core);
    g.addColorStop(0.35, mid);
    g.addColorStop(1, edge);
    x.fillStyle = g;
    x.fillRect(-0.5, -1.1, 1, 1.4);
  });
}

/** A four-point glint: two long thin rays and a soft core (units: radius 1). */
export function bakeGlint(px: number): Sprite | null {
  const k = Math.max(4, Math.round(px / 2));
  return bake(k, [-1, -1, 1, 1], 0, () => {}, null, null, (x) => {
    const halo = x.createRadialGradient(0, 0, 0, 0, 0, 0.55);
    halo.addColorStop(0, 'rgba(255,236,170,.9)');
    halo.addColorStop(0.3, 'rgba(255,200,80,.35)');
    halo.addColorStop(1, 'rgba(255,190,60,0)');
    x.fillStyle = halo;
    x.fillRect(-1, -1, 2, 2);
    // Pinched rays: a long thin diamond each way.
    x.fillStyle = 'rgba(255,248,220,.95)';
    x.beginPath();
    x.moveTo(-1, 0);
    x.quadraticCurveTo(0, 0.07, 1, 0);
    x.quadraticCurveTo(0, -0.07, -1, 0);
    x.fill();
    x.beginPath();
    x.moveTo(0, -1);
    x.quadraticCurveTo(0.07, 0, 0, 1);
    x.quadraticCurveTo(-0.07, 0, 0, -1);
    x.fill();
  });
}

/**
 * The headlights' light thrown through the window across the room: a broad soft band (units: 1 wide, 1 tall), brightest
 * down its middle, the shadows of two mullions faint in it, fading out at the top and bottom.
 */
export function bakeBeam(): Sprite | null {
  return bake(128, [-0.5, 0, 0.5, 1], 0, () => {}, null, null, (x) => {
    const across = x.createLinearGradient(-0.5, 0, 0.5, 0);
    // Two soft dips where the mullions' shadows fall.
    for (const [o, a] of [[0, 0], [0.2, 0.5], [0.3, 0.72], [0.33, 0.5], [0.36, 0.86], [0.5, 1], [0.64, 0.86], [0.67, 0.5], [0.7, 0.72], [0.8, 0.5], [1, 0]] as const) {
      across.addColorStop(o, `rgba(255,236,205,${a})`);
    }
    x.fillStyle = across;
    x.fillRect(-0.5, 0, 1, 1);
    x.globalCompositeOperation = 'destination-out';
    const ends = x.createLinearGradient(0, 0, 0, 1);
    ends.addColorStop(0, 'rgba(0,0,0,.9)');
    ends.addColorStop(0.25, 'rgba(0,0,0,0)');
    ends.addColorStop(0.8, 'rgba(0,0,0,0)');
    ends.addColorStop(1, 'rgba(0,0,0,.8)');
    x.fillStyle = ends;
    x.fillRect(-0.5, 0, 1, 1);
    x.globalCompositeOperation = 'source-over';
  });
}

/** The headlight's cone on the road ahead (units: 1 long, origin at the lamp, pointing +x). */
export function bakeCone(px: number): Sprite | null {
  const k = Math.max(8, Math.round(px));
  return bake(k, [0, -0.3, 1, 0.3], 0, () => {}, null, null, (x) => {
    x.beginPath();
    x.moveTo(0, -0.03);
    x.lineTo(1, -0.22);
    x.quadraticCurveTo(1.05, 0, 1, 0.26);
    x.lineTo(0, 0.03);
    x.closePath();
    x.clip();
    const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,240,205,.55)');
    g.addColorStop(0.4, 'rgba(255,236,200,.18)');
    g.addColorStop(1, 'rgba(255,236,200,0)');
    x.fillStyle = g;
    x.fillRect(0, -0.3, 1.1, 0.6);
  });
}

/** Draws `s` with its origin at (x, y) CSS px, `unit` CSS px per unit, turned `rot` about the origin, mirrored by `sx`. */
export function blit(c: Ctx, s: Sprite | null | undefined, x: number, y: number, unit: number, rot = 0, sx = 1, sy = 1): void {
  if (!s) return;
  const k = unit / s.k;
  c.save();
  c.translate(x, y);
  if (rot) c.rotate(rot);
  if (sx !== 1 || sy !== 1) c.scale(sx, sy);
  c.drawImage(s.c, -s.ax * k, -s.ay * k, s.c.width * k, s.c.height * k);
  c.restore();
}
