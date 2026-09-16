const DEG = Math.PI / 180;
const HORIZONTAL_ACCELERATION = 1.8;
const VERTICAL_ACCELERATION = 1.2;
const YAW_ACCELERATION = 180;
const MAX_YAW_RATE = 100;
const MAX_TILT = 9;
const GRAVITY = 9;
const DRONE = { hx: 0.28, hy: 0.16, hz: 0.28 };
const ROOM = { minx: -8.7, maxx: 8.7, miny: 0, maxy: 3.5, minz: -5.7, maxz: 5.7 };
const BLOCKING_OPS = new Set(["takeoff", "land", "up", "down", "left", "right", "forward", "back", "cw", "ccw", "go", "curve", "jump", "flip"]);

function aabb(x, y, z, sx, sy, sz, landing = false) {
  return {
    minx: x - sx / 2,
    maxx: x + sx / 2,
    miny: y - sy / 2,
    maxy: y + sy / 2,
    minz: z - sz / 2,
    maxz: z + sz / 2,
    landing
  };
}

function overlaps(a, b) {
  return a.minx < b.maxx && a.maxx > b.minx && a.miny < b.maxy && a.maxy > b.miny && a.minz < b.maxz && a.maxz > b.minz;
}

const OBSTACLES = [
  aabb(0, 2, -6, 18, 4, 0.12),
  aabb(-9, 2, 0, 0.12, 4, 12),
  ...[[-5, -2], [-1.5, -2], [-5, 1], [-1.5, 1]].flatMap(([x, z]) => [
    aabb(x, 0.73, z, 2.5, 0.08, 1.1, true),
    aabb(x, 1.25, z - 0.25, 0.85, 0.55, 0.06),
    aabb(x, 0.48, z + 1, 0.72, 0.12, 0.72),
    aabb(x, 0.82, z + 1.3, 0.72, 0.75, 0.1)
  ]),
  aabb(6, 0.75, 0, 3.2, 0.1, 3.2, true),
  ...[[4, 0], [8, 0], [5, -2], [7, -2], [5, 2], [7, 2]].map(([x, z]) => aabb(x, 0.45, z, 0.65, 0.15, 0.65)),
  aabb(-5, 0.42, 4.6, 3.2, 0.55, 1.25, true),
  aabb(-5, 0.85, 5.05, 3.2, 0.85, 0.25),
  ...[-3.5, -1.5, 0.5, 2.5, 4.5].map(z => aabb(3.8, 1.45, z, 0.06, 2.9, 1.75)),
  ...[[-8, 5.2], [2.8, -5.2], [8.2, 5.1]].map(([x, z]) => aabb(x, 0.75, z, 0.7, 1.5, 0.7))
];

const MISSION_PADS = {
  m1: { x: -7, y: 0, z: -4 },
  m2: { x: -3.5, y: 0, z: -4 },
  m3: { x: 0, y: 0, z: -4 },
  m4: { x: 3.5, y: 0, z: -4 },
  m5: { x: 7, y: 0, z: -4 },
  m6: { x: -7, y: 0, z: 4 },
  m7: { x: 0, y: 0, z: 4 },
  m8: { x: 7, y: 0, z: 4 }
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function isBlockingCommand(command) {
  const op = String(command).trim().toLowerCase().split(/\s+/)[0];
  return BLOCKING_OPS.has(op);
}

export class TelloSimulator {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      sdkMode: false,
      streaming: false,
      flying: false,
      crashed: false,
      x: -5,
      y: 0,
      z: 3,
      yaw: 0,
      pitch: 0,
      roll: 0,
      yawRate: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      battery: 100,
      flightTime: 0,
      temperature: 48,
      barometer: 0,
      speed: 50,
      lastCommand: "ready",
      collision: false,
      missionPadEnabled: false,
      missionPadDirection: 2,
      motorsRunning: false,
      flipPitch: 0,
      flipRoll: 0,
      wifiSsid: "OFLSIM",
      accessPoint: null
    };
    this.motion = null;
    this.commandFailed = false;
    this.rc = { lr: 0, fb: 0, ud: 0, yaw: 0, expires: 0 };
    this.lastCommandAt = Date.now();
  }

  groundClearance() {
    return Math.max(0, this.state.y - this.landingHeightAt(this.state.x, this.state.z));
  }

  snapshot() {
    const tof = Math.round(this.groundClearance() * 100);
    return { ...this.state, height: tof, tof };
  }

  landingHeightAt(x, z) {
    let height = 0;
    for (const obstacle of OBSTACLES) {
      if (!obstacle.landing) continue;
      if (x >= obstacle.minx && x <= obstacle.maxx && z >= obstacle.minz && z <= obstacle.maxz) {
        height = Math.max(height, obstacle.maxy);
      }
    }
    return height;
  }

  droneBox(x = this.state.x, y = this.state.y, z = this.state.z) {
    return {
      minx: x - DRONE.hx,
      maxx: x + DRONE.hx,
      miny: y,
      maxy: y + DRONE.hy,
      minz: z - DRONE.hz,
      maxz: z + DRONE.hz
    };
  }

  failCommand() {
    this.commandFailed = true;
    this.motion = null;
    this.rc.expires = 0;
  }

  crash() {
    const s = this.state;
    this.failCommand();
    s.collision = true;
    s.crashed = true;
    s.flying = false;
    s.motorsRunning = false;
    s.vx = s.vz = 0;
    s.yawRate = 0;
    s.flipPitch = 0;
    s.flipRoll = 0;
  }

  settleOn(height) {
    const s = this.state;
    s.y = height;
    s.vx = s.vy = s.vz = 0;
    s.flying = false;
    s.motorsRunning = false;
    this.motion = null;
  }

  resolveCollisions(previous) {
    const s = this.state;
    if (s.x < ROOM.minx || s.x > ROOM.maxx || s.z < ROOM.minz || s.z > ROOM.maxz || s.y > ROOM.maxy) {
      s.x = clamp(s.x, ROOM.minx, ROOM.maxx);
      s.y = Math.min(s.y, ROOM.maxy);
      s.z = clamp(s.z, ROOM.minz, ROOM.maxz);
      this.crash();
      return;
    }

    const box = this.droneBox();
    for (const obstacle of OBSTACLES) {
      if (!overlaps(box, obstacle)) continue;
      const fromAbove = previous.y >= obstacle.maxy - 0.04 && s.vy <= 0.15;
      if (obstacle.landing && fromAbove) {
        this.settleOn(obstacle.maxy);
        continue;
      }
      s.x = previous.x;
      s.y = previous.y;
      s.z = previous.z;
      this.crash();
      return;
    }
  }

  detectedMissionPad() {
    if (!this.state.missionPadEnabled || this.state.missionPadDirection === 1) return null;
    let detected = null;
    let distance = Infinity;
    for (const [id, pad] of Object.entries(MISSION_PADS)) {
      const current = Math.hypot(this.state.x - pad.x, this.state.z - pad.z);
      if (current < distance && current <= 1.2 && this.state.y <= 3) {
        detected = { id, ...pad };
        distance = current;
      }
    }
    return detected;
  }

  padTarget(id, x, y, z) {
    const pad = MISSION_PADS[id];
    if (!pad) return null;
    return { x: pad.x + x / 100, y: pad.y + z / 100, z: pad.z + y / 100 };
  }

  movePath(points, speed) {
    const [target, ...waypoints] = points;
    this.motion = { target, waypoints, speed: Math.max(0.1, speed), passThrough: true };
  }

  tick(dt) {
    const s = this.state;
    const previous = { x: s.x, y: s.y, z: s.z };
    const previousVelocity = { x: s.vx, y: s.vy, z: s.vz };
    if (!s.crashed) s.collision = false;
    if (s.flying) {
      s.flightTime += dt;
      s.battery = Math.max(0, s.battery - dt / 180);
      s.temperature = 48 + Math.sin(s.flightTime * 0.2) * 2;
      if ((Date.now() - this.lastCommandAt > 15000 || s.battery <= 10) && !this.motion?.landing) {
        this.moveTo({ y: this.landingHeightAt(s.x, s.z) }, s.speed / 100, true);
      }
    }

    let desired = { x: 0, y: 0, z: 0 };
    let acceleration = HORIZONTAL_ACCELERATION;
    if (this.motion?.target) {
      const target = this.motion.target;
      const error = {
        x: (target.x ?? s.x) - s.x,
        y: (target.y ?? s.y) - s.y,
        z: (target.z ?? s.z) - s.z
      };
      const distance = Math.hypot(error.x, error.y, error.z);
      if (this.motion.passThrough && distance < 0.08 && this.motion.waypoints.length) {
        this.motion.target = this.motion.waypoints.shift();
      }
      acceleration = Math.abs(error.y) > Math.hypot(error.x, error.z) ? VERTICAL_ACCELERATION : HORIZONTAL_ACCELERATION;
      if (distance > 0.004) {
        const stoppingSpeed = Math.sqrt(2 * acceleration * distance);
        const speed = Math.min(this.motion.speed, stoppingSpeed);
        desired = { x: error.x / distance * speed, y: error.y / distance * speed, z: error.z / distance * speed };
      }
      if (distance <= 0.008 && Math.hypot(s.vx, s.vy, s.vz) < 0.04 && !this.motion?.waypoints?.length) {
        s.x = target.x ?? s.x;
        s.y = target.y ?? s.y;
        s.z = target.z ?? s.z;
        s.vx = s.vy = s.vz = 0;
        if (this.motion.landing) s.flying = false;
        this.motion = null;
      }
    } else if (s.flying && Date.now() < this.rc.expires) {
      const angle = s.yaw * DEG;
      const localX = this.rc.lr / 100 * 2;
      const localZ = -this.rc.fb / 100 * 2;
      desired.x = localX * Math.cos(angle) - localZ * Math.sin(angle);
      desired.z = localX * Math.sin(angle) + localZ * Math.cos(angle);
      desired.y = this.rc.ud / 100 * 1.5;
    } else if (!s.flying && s.y > this.landingHeightAt(s.x, s.z) + 0.008) {
      desired.y = -8;
      acceleration = GRAVITY;
    }

    const velocityDelta = { x: desired.x - s.vx, y: desired.y - s.vy, z: desired.z - s.vz };
    const deltaLength = Math.hypot(velocityDelta.x, velocityDelta.y, velocityDelta.z);
    const maxVelocityChange = acceleration * dt;
    const velocityScale = deltaLength > maxVelocityChange ? maxVelocityChange / deltaLength : 1;
    s.vx += velocityDelta.x * velocityScale;
    s.vy += velocityDelta.y * velocityScale;
    s.vz += velocityDelta.z * velocityScale;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;

    let desiredYawRate = 0;
    if (this.motion?.yawRemaining !== undefined) {
      const remaining = Math.abs(this.motion.yawRemaining);
      desiredYawRate = this.motion.yawDirection * Math.min(MAX_YAW_RATE, Math.sqrt(2 * YAW_ACCELERATION * remaining));
    } else if (s.flying && Date.now() < this.rc.expires) {
      desiredYawRate = this.rc.yaw / 100 * MAX_YAW_RATE;
    }
    const yawRateDelta = clamp(desiredYawRate - s.yawRate, -YAW_ACCELERATION * dt, YAW_ACCELERATION * dt);
    s.yawRate += yawRateDelta;
    let yawStep = s.yawRate * dt;
    if (this.motion?.yawRemaining !== undefined) {
      if (Math.sign(yawStep) === this.motion.yawDirection && Math.abs(yawStep) >= Math.abs(this.motion.yawRemaining)) {
        yawStep = this.motion.yawRemaining;
        s.yawRate = 0;
        this.motion = null;
      } else {
        this.motion.yawRemaining -= yawStep;
      }
    }
    s.yaw += yawStep;

    if (this.motion?.flip) {
      this.motion.elapsed += dt;
      const progress = clamp(this.motion.elapsed / 0.7, 0, 1);
      const rotation = Math.sin(progress * Math.PI) * 180 * this.motion.flip.sign;
      s.flipPitch = this.motion.flip.axis === "pitch" ? rotation : 0;
      s.flipRoll = this.motion.flip.axis === "roll" ? rotation : 0;
      if (progress >= 1) {
        s.flipPitch = 0;
        s.flipRoll = 0;
        this.motion = null;
      }
    }

    const ax = (s.vx - previousVelocity.x) / Math.max(dt, 0.001);
    const az = (s.vz - previousVelocity.z) / Math.max(dt, 0.001);
    const angle = s.yaw * DEG;
    const forwardAcceleration = -ax * Math.sin(angle) - az * Math.cos(angle);
    const rightAcceleration = ax * Math.cos(angle) + az * Math.sin(angle);
    const targetPitch = clamp(-forwardAcceleration / HORIZONTAL_ACCELERATION * MAX_TILT, -MAX_TILT, MAX_TILT);
    const targetRoll = clamp(-rightAcceleration / HORIZONTAL_ACCELERATION * MAX_TILT, -MAX_TILT, MAX_TILT);
    const attitudeBlend = Math.min(1, dt * 7);
    s.pitch += (targetPitch - s.pitch) * attitudeBlend;
    s.roll += (targetRoll - s.roll) * attitudeBlend;

    const landingHeight = this.motion?.landing ? this.motion.target.y : null;
    if (landingHeight !== null && s.y <= landingHeight + 0.008) {
      this.settleOn(landingHeight);
    }

    if (!s.flying && !this.motion) {
      const floor = this.landingHeightAt(s.x, s.z);
      if (s.y < floor) s.y = floor;
      if (s.y <= floor + 0.008) {
        s.y = floor;
        s.vy = 0;
      }
    }

    const isVerticalTransition = this.motion?.target?.y !== undefined;
    if (s.flying && !isVerticalTransition) s.y = Math.max(s.y, 0.25);
    this.resolveCollisions(previous);

    s.barometer = s.y * 100;
    s.yaw = ((s.yaw % 360) + 360) % 360;
  }

  moveTo(target, speed = this.state.speed / 100, landing = false) {
    if (target.yaw !== undefined) {
      const delta = target.yaw - this.state.yaw;
      this.motion = { yawRemaining: delta, yawDirection: Math.sign(delta) || 1 };
      return;
    }
    this.motion = { target, speed: Math.max(0.1, speed), landing };
  }

  execute(raw) {
    const command = String(raw).trim().toLowerCase();
    const [op, ...args] = command.split(/\s+/);
    const s = this.state;
    s.lastCommand = command;
    if (s.sdkMode) this.lastCommandAt = Date.now();

    const query = {
      "battery?": () => `${Math.round(s.battery)}`,
      "time?": () => `${Math.round(s.flightTime)}`,
      "speed?": () => `${Math.round(s.speed)}`,
      "height?": () => `${Math.round(this.groundClearance() * 100)}`,
      "temp?": () => `${Math.round(s.temperature)}~${Math.round(s.temperature + 3)}`,
      "attitude?": () => `pitch:${Math.round(s.pitch)};roll:${Math.round(s.roll)};yaw:${Math.round(s.yaw)};`,
      "baro?": () => `${s.barometer.toFixed(2)}`,
      "acceleration?": () => "0.00;0.00;-1000.00;",
      "tof?": () => `${Math.round(this.groundClearance() * 100)}`,
      "wifi?": () => "90",
      "sn?": () => "OFLSIM001",
      "sdk?": () => "20"
    };
    if (query[op]) return query[op]();
    if (op === "command") { s.sdkMode = true; this.lastCommandAt = Date.now(); return "ok"; }
    if (op === "emergency") {
      this.failCommand();
      s.flying = false;
      s.crashed = false;
      s.collision = false;
      s.y = this.landingHeightAt(s.x, s.z);
      s.vx = s.vy = s.vz = s.yawRate = 0;
      return "ok";
    }
    if (!s.sdkMode) return "error Not in SDK mode; send 'command' first";
    this.lastCommandAt = Date.now();

    if (op === "keepalive") return "ok";
    if (op === "streamon") { s.streaming = true; return "ok"; }
    if (op === "streamoff") { s.streaming = false; return "ok"; }
    if (op === "mon") { s.missionPadEnabled = true; return "ok"; }
    if (op === "moff") { s.missionPadEnabled = false; return "ok"; }
    if (op === "mdirection") {
      const direction = Number(args[0]);
      if (!s.missionPadEnabled || args.length !== 1 || ![0, 1, 2].includes(direction)) return "error";
      s.missionPadDirection = direction;
      return "ok";
    }
    if (op === "wifi" || op === "ap") {
      if (args.length !== 2 || args.some(value => !value)) return "error";
      if (op === "wifi") s.wifiSsid = args[0];
      else s.accessPoint = { ssid: args[0] };
      return "ok";
    }
    if (op === "motoron") { if (s.flying) return "error"; s.motorsRunning = true; return "ok"; }
    if (op === "motoroff") { if (s.flying) return "error"; s.motorsRunning = false; return "ok"; }

    if (op === "takeoff") {
      if (s.flying) return "error Already flying";
      s.crashed = false;
      s.collision = false;
      s.flying = true;
      this.commandFailed = false;
      this.moveTo({ y: Math.min(3.5, s.y + 1.2) });
      return "ok";
    }
    if (op === "land") {
      if (!s.flying) return "error Not flying";
      this.commandFailed = false;
      this.moveTo({ y: this.landingHeightAt(s.x, s.z) }, this.state.speed / 100, true);
      return "ok";
    }
    if (op === "stop") {
      this.failCommand();
      return "ok";
    }
    if (op === "speed") { const v = Number(args[0]); if (v < 10 || v > 100) return "error"; s.speed = v; return "ok"; }
    if (op === "rc") {
      if (!s.flying || args.length !== 4) return "error";
      const vals = args.map(Number);
      if (vals.some(v => !Number.isFinite(v) || Math.abs(v) > 100)) return "error";
      [this.rc.lr, this.rc.fb, this.rc.ud, this.rc.yaw] = vals;
      this.rc.expires = Date.now() + 500;
      return "ok";
    }
    if (!s.flying) return "error Not flying";
    if (this.motion) return "error Motor busy";
    const cm = Number(args[0]);
    const meters = cm / 100;
    const rad = s.yaw * DEG;
    const directional = {
      up: { y: s.y + meters }, down: { y: s.y - meters },
      right: { x: s.x + Math.cos(rad) * meters, z: s.z + Math.sin(rad) * meters },
      left: { x: s.x - Math.cos(rad) * meters, z: s.z + Math.sin(rad) * meters },
      forward: { x: s.x - Math.sin(rad) * meters, z: s.z - Math.cos(rad) * meters },
      back: { x: s.x + Math.sin(rad) * meters, z: s.z + Math.cos(rad) * meters }
    };
    if (directional[op] && cm >= 20 && cm <= 500) {
      this.commandFailed = false;
      this.moveTo(directional[op]);
      return "ok";
    }
    if ((op === "cw" || op === "ccw") && cm >= 1 && cm <= 360) {
      this.commandFailed = false;
      this.moveTo({ yaw: s.yaw + (op === "cw" ? -cm : cm) });
      return "ok";
    }
    if (op === "flip" && ["l", "r", "f", "b"].includes(args[0])) {
      const direction = args[0];
      this.commandFailed = false;
      this.motion = { flip: { axis: ["f", "b"].includes(direction) ? "pitch" : "roll", sign: ["f", "r"].includes(direction) ? 1 : -1 }, elapsed: 0 };
      return "ok";
    }
    if (op === "go" && args.length >= 4) {
      const [x, y, z, speed] = args.map(Number);
      if ([x, y, z, speed].some(v => !Number.isFinite(v)) || speed < 10 || speed > 100 || [x, y, z].some(v => v < -500 || v > 500) || [x, y, z].every(v => Math.abs(v) < 20)) return "error";
      const padTarget = args[4] ? this.padTarget(args[4], x, y, z) : null;
      if (args[4] && !padTarget) return "error";
      const target = padTarget || { x: s.x + (x * Math.cos(rad) - y * Math.sin(rad)) / 100, y: s.y + z / 100, z: s.z + (x * Math.sin(rad) + y * Math.cos(rad)) / 100 };
      this.commandFailed = false;
      this.moveTo(target, speed / 100);
      return "ok";
    }
    if (op === "curve" && (args.length === 7 || args.length === 8)) {
      const values = args.slice(0, 7).map(Number);
      if (values.some(v => !Number.isFinite(v))) return "error";
      const [x1, y1, z1, x2, y2, z2, speed] = values;
      if (speed < 10 || speed > 60 || values.slice(0, 6).some(v => v < -500 || v > 500)) return "error";
      const origin = args[7] ? MISSION_PADS[args[7]] : { x: s.x, y: s.y, z: s.z };
      if (!origin) return "error";
      const control = { x: origin.x + x1 / 100, y: origin.y + z1 / 100, z: origin.z + y1 / 100 };
      const end = { x: origin.x + x2 / 100, y: origin.y + z2 / 100, z: origin.z + y2 / 100 };
      const start = { x: s.x, y: s.y, z: s.z };
      const sideA = Math.hypot(control.x - start.x, control.y - start.y, control.z - start.z);
      const sideB = Math.hypot(end.x - control.x, end.y - control.y, end.z - control.z);
      const sideC = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
      const ux = control.x - start.x, uy = control.y - start.y, uz = control.z - start.z;
      const vx = end.x - start.x, vy = end.y - start.y, vz = end.z - start.z;
      const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      const radius = area2 > 0 ? sideA * sideB * sideC / (2 * area2) : Infinity;
      if (radius < 0.5 || radius > 10) return "error";
      const points = Array.from({ length: 16 }, (_, index) => {
        const t = (index + 1) / 16;
        const a = (1 - t) ** 2, b = 2 * (1 - t) * t, c = t ** 2;
        return { x: a * start.x + b * control.x + c * end.x, y: a * start.y + b * control.y + c * end.y, z: a * start.z + b * control.z + c * end.z };
      });
      this.commandFailed = false;
      this.movePath(points, speed / 100);
      return "ok";
    }
    if (op === "jump" && args.length === 7) {
      const [x, y, z, speed, yaw] = args.slice(0, 5).map(Number);
      const destination = this.padTarget(args[6], 0, 0, z);
      const first = this.padTarget(args[5], x, y, z);
      if (!first || !destination || speed < 10 || speed > 100 || ![x, y, z, yaw].every(Number.isFinite)) return "error";
      this.commandFailed = false;
      this.movePath([first, destination], speed / 100);
      s.yaw = ((yaw % 360) + 360) % 360;
      return "ok";
    }
    return "error Unknown command";
  }

  telemetry() {
    const s = this.state;
    const pad = this.detectedMissionPad();
    const tof = Math.round(this.groundClearance() * 100);
    const mission = s.missionPadEnabled ? `mid:${pad ? Number(pad.id.slice(1)) : -1};x:${pad ? Math.round((s.x - pad.x) * 100) : 0};y:${pad ? Math.round((s.z - pad.z) * 100) : 0};z:${pad ? Math.round((s.y - pad.y) * 100) : 0};mpry:0,0,${Math.round(s.yaw)};` : "";
    return `${mission}pitch:${Math.round(s.pitch)};roll:${Math.round(s.roll)};yaw:${Math.round(s.yaw)};vgx:${Math.round(s.vx * 100)};vgy:${Math.round(s.vz * 100)};vgz:${Math.round(s.vy * 100)};templ:${Math.round(s.temperature)};temph:${Math.round(s.temperature + 3)};tof:${tof};h:${tof};bat:${Math.round(s.battery)};baro:${s.barometer.toFixed(2)};time:${Math.round(s.flightTime)};agx:0;agy:0;agz:-1000;`;
  }
}
