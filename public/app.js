import * as pc from "/vendor/playcanvas/playcanvas.mjs";

const canvas = document.getElementById("application");
const app = new pc.Application(canvas, {
  graphicsDeviceOptions: { alpha: false, antialias: true, preserveDrawingBuffer: true }
});
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
app.scene.ambientLight = new pc.Color(0.28, 0.32, 0.34);
app.scene.exposure = 1.05;
app.scene.gammaCorrection = pc.GAMMA_SRGB;
app.start();

function material(hex, metalness = 0, gloss = 0.4) {
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color().fromString(hex);
  mat.metalness = metalness;
  mat.gloss = gloss;
  mat.update();
  return mat;
}

const mats = {
  floor: material("#89908b", 0, 0.15),
  wall: material("#d4d1c7", 0, 0.18),
  dark: material("#172126", 0.1, 0.5),
  wood: material("#6e4d33", 0, 0.25),
  teal: material("#38bda7", 0.1, 0.65),
  glass: material("#92c7cb", 0, 0.75),
  white: material("#e9ece8", 0, 0.45),
  plant: material("#315f45", 0, 0.15),
  pot: material("#9d7156", 0, 0.2)
};

function box(name, pos, scale, mat, parent = app.root) {
  const entity = new pc.Entity(name);
  entity.addComponent("render", { type: "box" });
  entity.setPosition(...pos);
  entity.setLocalScale(...scale);
  entity.render.material = mat;
  parent.addChild(entity);
  return entity;
}

function cylinder(name, pos, scale, mat, parent = app.root) {
  const entity = new pc.Entity(name);
  entity.addComponent("render", { type: "cylinder" });
  entity.setPosition(...pos);
  entity.setLocalScale(...scale);
  entity.render.material = mat;
  parent.addChild(entity);
  return entity;
}

function buildSky() {
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 1024;
  skyCanvas.height = 512;
  const ctx = skyCanvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 512);
  gradient.addColorStop(0, "#237bc5");
  gradient.addColorStop(0.46, "#72b9e7");
  gradient.addColorStop(0.72, "#d8eaf2");
  gradient.addColorStop(1, "#f1d6ad");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 512);

  for (const [x, y, size] of [[100, 145, 1.1], [315, 105, 0.8], [545, 165, 1.3], [790, 95, 0.9], [930, 190, 0.7]]) {
    ctx.fillStyle = "rgba(255,255,255,.72)";
    for (const part of [[0, 0, 55, 18], [45, -10, 48, 24], [90, 2, 60, 17]]) {
      ctx.beginPath();
      ctx.ellipse(x + part[0] * size, y + part[1] * size, part[2] * size, part[3] * size, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const texture = new pc.Texture(app.graphicsDevice, { width: 1024, height: 512, mipmaps: true });
  texture.setSource(skyCanvas);
  const skyMaterial = new pc.StandardMaterial();
  skyMaterial.diffuseMap = texture;
  skyMaterial.emissiveMap = texture;
  skyMaterial.emissive.set(1, 1, 1);
  skyMaterial.useLighting = false;
  skyMaterial.cull = pc.CULLFACE_FRONT;
  skyMaterial.depthWrite = false;
  skyMaterial.update();

  const sky = new pc.Entity("sky");
  sky.addComponent("render", { type: "sphere" });
  sky.setLocalScale(120, 120, 120);
  sky.render.material = skyMaterial;
  app.root.addChild(sky);
}

function buildOffice() {
  box("floor", [0, -0.08, 0], [18, 0.16, 12], mats.floor);
  box("back wall", [0, 2, -6], [18, 4, 0.12], mats.wall);
  box("left wall", [-9, 2, 0], [0.12, 4, 12], mats.wall);

  for (const [index, x, z] of [[1, -7, -4], [2, -3.5, -4], [3, 0, -4], [4, 3.5, -4], [5, 7, -4], [6, -7, 4], [7, 0, 4], [8, 7, 4]]) {
    box(`mission pad ${index}`, [x, 0.012, z], [0.72, 0.025, 0.72], mats.dark);
    box(`mission pad mark ${index}`, [x, 0.027, z], [0.42, 0.012, 0.12], index % 2 ? mats.teal : mats.white);
  }

  for (let x = -7.5; x <= 7.5; x += 3) {
    box("window", [x, 2.4, -5.92], [2.45, 1.7, 0.05], mats.glass);
    box("mullion", [x + 1.3, 2.4, -5.84], [0.08, 1.85, 0.12], mats.dark);
  }

  for (let z = -3.5; z <= 4.5; z += 2) {
    box("glass partition", [3.8, 1.45, z], [0.06, 2.9, 1.75], mats.glass);
    box("frame", [3.75, 1.45, z + 1], [0.1, 3, 0.07], mats.dark);
  }

  for (const [x, z] of [[-5, -2], [-1.5, -2], [-5, 1], [-1.5, 1]]) {
    box("desk", [x, 0.73, z], [2.5, 0.08, 1.1], mats.wood);
    for (const dx of [-1, 1]) cylinder("leg", [x + dx, 0.36, z], [0.07, 0.7, 0.07], mats.dark);
    box("monitor", [x, 1.25, z - 0.25], [0.85, 0.55, 0.06], mats.dark);
    cylinder("stand", [x, 0.92, z - 0.25], [0.06, 0.35, 0.06], mats.dark);
    box("chair", [x, 0.48, z + 1], [0.72, 0.12, 0.72], mats.teal);
    box("chairback", [x, 0.82, z + 1.3], [0.72, 0.75, 0.1], mats.teal);
  }

  box("conference table", [6, 0.75, 0], [3.2, 0.1, 3.2], mats.wood);
  for (const pos of [[4.7, 0.35, -1.3], [7.3, 0.35, -1.3], [4.7, 0.35, 1.3], [7.3, 0.35, 1.3]]) {
    cylinder("table leg", pos, [0.08, 0.7, 0.08], mats.dark);
  }
  for (const [x, z] of [[4, 0], [8, 0], [5, -2], [7, -2], [5, 2], [7, 2]]) {
    cylinder("stool", [x, 0.45, z], [0.65, 0.15, 0.65], mats.teal);
  }

  box("sofa", [-5, 0.42, 4.6], [3.2, 0.55, 1.25], mats.dark);
  box("sofa back", [-5, 0.85, 5.05], [3.2, 0.85, 0.25], mats.dark);
  box("rug", [-2.5, 0.02, 4.4], [5, 0.03, 2.2], mats.teal);

  for (const [x, z] of [[-8, 5.2], [2.8, -5.2], [8.2, 5.1]]) {
    cylinder("pot", [x, 0.3, z], [0.5, 0.6, 0.5], mats.pot);
    for (let i = 0; i < 5; i++) {
      const leaf = box("leaf", [x, 0.9 + i * 0.06, z], [0.18, 1, 0.38], mats.plant);
      leaf.setEulerAngles(0, i * 72, 25);
    }
  }

  for (let x = -7; x <= 7; x += 3.5) {
    for (let z = -4; z <= 4; z += 4) {
      box("light panel", [x, 3.85, z], [2, 0.03, 0.35], mats.white);
      const light = new pc.Entity("area light");
      light.addComponent("light", {
        type: "omni",
        color: new pc.Color(0.85, 0.95, 0.9),
        intensity: 1.1,
        range: 5,
        castShadows: false
      });
      light.setPosition(x, 3.5, z);
      app.root.addChild(light);
    }
  }

  const sun = new pc.Entity("sun");
  sun.addComponent("light", {
    type: "directional",
    color: new pc.Color(1, 0.92, 0.78),
    intensity: 1.7,
    castShadows: true,
    shadowResolution: 2048
  });
  sun.setEulerAngles(48, -35, 0);
  app.root.addChild(sun);
}

function buildDrone() {
  const drone = new pc.Entity("drone");
  app.root.addChild(drone);
  box("body", [0, 0, 0], [0.55, 0.14, 0.35], mats.white, drone);
  box("camera", [0, -0.02, -0.21], [0.2, 0.13, 0.09], mats.dark, drone);

  const rotors = [];
  for (const [x, z] of [[-0.42, -0.3], [0.42, -0.3], [-0.42, 0.3], [0.42, 0.3]]) {
    const arm = box("arm", [x * 0.5, 0, z * 0.5], [0.09, 0.06, Math.hypot(x, z)], mats.dark, drone);
    arm.setLocalEulerAngles(0, Math.atan2(x, z) * 180 / Math.PI, 0);
    cylinder("motor", [x, 0.02, z], [0.12, 0.1, 0.12], mats.dark, drone);
    rotors.push(cylinder("rotor", [x, 0.1, z], [0.5, 0.018, 0.07], mats.teal, drone));
  }

  const glow = new pc.Entity("status glow");
  glow.addComponent("light", {
    type: "omni",
    color: new pc.Color(0.2, 1, 0.7),
    intensity: 1,
    range: 1
  });
  glow.setLocalPosition(0, 0, -0.25);
  drone.addChild(glow);
  return { drone, rotors };
}

buildSky();
buildOffice();
const { drone, rotors } = buildDrone();

const camera = new pc.Entity("camera");
camera.addComponent("camera", { clearColor: new pc.Color(0.025, 0.045, 0.05), fov: 52 });
app.root.addChild(camera);

const fpvCamera = new pc.Entity("fpv camera");
fpvCamera.addComponent("camera", { clearColor: new pc.Color(0.025, 0.045, 0.05), fov: 82.6, priority: 1 });
app.root.addChild(fpvCamera);

const fpvPanel = document.getElementById("fpv");
let fpvViewport = { x: 0, y: 0, width: 0, height: 0 };
let fpvPosition = null;
let fpvDrag = null;

function updateFpvViewport() {
  if (fpvPanel.classList.contains("ui-hidden")) {
    fpvCamera.enabled = false;
    return;
  }
  fpvCamera.enabled = true;
  const rect = fpvPanel.getBoundingClientRect();
  if (!fpvPosition) fpvPosition = { x: rect.left, y: rect.top };
  const width = rect.width;
  const height = rect.height;
  fpvPosition.x = Math.max(0, Math.min(canvas.clientWidth - width, fpvPosition.x));
  fpvPosition.y = Math.max(0, Math.min(canvas.clientHeight - height, fpvPosition.y));
  fpvPanel.style.left = `${fpvPosition.x}px`;
  fpvPanel.style.top = `${fpvPosition.y}px`;
  fpvPanel.style.right = "auto";
  fpvViewport = { x: fpvPosition.x, y: fpvPosition.y, width, height };
  fpvCamera.camera.rect = new pc.Vec4(
    fpvViewport.x / canvas.clientWidth,
    1 - (fpvViewport.y + height) / canvas.clientHeight,
    width / canvas.clientWidth,
    height / canvas.clientHeight
  );
}

fpvPanel.firstElementChild.addEventListener("pointerdown", event => {
  const rect = fpvPanel.getBoundingClientRect();
  fpvDrag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
  fpvPanel.classList.add("dragging");
  fpvPanel.firstElementChild.setPointerCapture(event.pointerId);
});

fpvPanel.firstElementChild.addEventListener("pointermove", event => {
  if (!fpvDrag || event.pointerId !== fpvDrag.pointer) return;
  fpvPosition = {
    x: fpvDrag.left + event.clientX - fpvDrag.x,
    y: fpvDrag.top + event.clientY - fpvDrag.y
  };
  updateFpvViewport();
});

function stopFpvDrag() {
  fpvDrag = null;
  fpvPanel.classList.remove("dragging");
}

fpvPanel.firstElementChild.addEventListener("pointerup", stopFpvDrag);
fpvPanel.firstElementChild.addEventListener("pointercancel", stopFpvDrag);

const view = { yaw: 38, pitch: -24, speed: 5 };
const keys = new Set();
let drag = false;
let lastPointer = { x: 0, y: 0 };

function viewDirection() {
  const yaw = view.yaw * Math.PI / 180;
  const pitch = view.pitch * Math.PI / 180;
  return new pc.Vec3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
}

function updateCamera() {
  const position = camera.getPosition();
  const direction = viewDirection();
  camera.lookAt(position.x + direction.x, position.y + direction.y, position.z + direction.z);
}

camera.setPosition(9.2, 7.5, 12);
updateCamera();
updateFpvViewport();

canvas.addEventListener("pointerdown", event => {
  drag = true;
  lastPointer = { x: event.clientX, y: event.clientY };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", () => { drag = false; });
canvas.addEventListener("pointermove", event => {
  if (!drag) return;
  view.yaw -= (event.clientX - lastPointer.x) * 0.22;
  view.pitch = Math.max(-85, Math.min(85, view.pitch - (event.clientY - lastPointer.y) * 0.2));
  lastPointer = { x: event.clientX, y: event.clientY };
  updateCamera();
});
canvas.addEventListener("wheel", event => {
  view.speed = Math.max(1, Math.min(20, view.speed - event.deltaY * 0.01));
}, { passive: true });

window.addEventListener("keydown", event => {
  if (event.target instanceof HTMLInputElement) return;
  keys.add(event.code);
});
window.addEventListener("keyup", event => keys.delete(event.code));
window.addEventListener("blur", () => keys.clear());

let target = { x: -5, y: 0, z: 3, yaw: 0, flying: false, streaming: false, battery: 100, flightTime: 0 };
const droneAttitude = { pitch: 0, yaw: 0, roll: 0 };

function angleDelta(from, to) {
  return ((to - from + 540) % 360) - 180;
}

app.on("update", dt => {
  const position = drone.getPosition();
  const blend = Math.min(1, dt * 8);
  drone.setPosition(
    pc.math.lerp(position.x, target.x, blend),
    pc.math.lerp(position.y, target.y + 0.16, blend),
    pc.math.lerp(position.z, target.z, blend)
  );

  const attitudeBlend = Math.min(1, dt * 7);
  droneAttitude.pitch = pc.math.lerp(droneAttitude.pitch, (target.pitch || 0) + (target.flipPitch || 0), attitudeBlend);
  droneAttitude.yaw += angleDelta(droneAttitude.yaw, target.yaw) * attitudeBlend;
  droneAttitude.roll = pc.math.lerp(droneAttitude.roll, (target.roll || 0) + (target.flipRoll || 0), attitudeBlend);
  drone.setEulerAngles(droneAttitude.pitch, droneAttitude.yaw, droneAttitude.roll);

  if (target.flying || target.motorsRunning) {
    rotors.forEach((rotor, index) => rotor.rotateLocal(0, (index % 2 ? 1 : -1) * dt * 1800, 0));
  }

  const yaw = target.yaw * Math.PI / 180;
  fpvCamera.setPosition(target.x - Math.sin(yaw) * 0.18, target.y + 0.16, target.z - Math.cos(yaw) * 0.18);
  fpvCamera.setEulerAngles((target.pitch || 0) - 7, target.yaw, target.roll || 0);

  const lookYaw = view.yaw * Math.PI / 180;
  const forward = new pc.Vec3(-Math.sin(lookYaw), 0, -Math.cos(lookYaw));
  const right = new pc.Vec3(Math.cos(lookYaw), 0, -Math.sin(lookYaw));
  const movement = new pc.Vec3();
  if (keys.has("KeyW")) movement.add(forward);
  if (keys.has("KeyS")) movement.sub(forward);
  if (keys.has("KeyD")) movement.add(right);
  if (keys.has("KeyA")) movement.sub(right);
  if (keys.has("KeyE")) movement.y += 1;
  if (keys.has("KeyQ")) movement.y -= 1;
  if (movement.lengthSq() > 0) {
    const boost = keys.has("ShiftLeft") || keys.has("ShiftRight") ? 2.5 : 1;
    movement.normalize().mulScalar(view.speed * boost * dt);
    camera.translate(movement);
    updateCamera();
  }
});

function $(id) {
  return document.getElementById(id);
}

function log(command, response) {
  const row = document.createElement("div");
  row.innerHTML = `<i>${command.toUpperCase()}</i>${response}`;
  $("log").prepend(row);
}

document.querySelectorAll("[data-ui-toggle]").forEach(button => {
  button.onclick = () => {
    const element = document.querySelector(button.dataset.uiToggle);
    const hidden = element.classList.toggle("ui-hidden");
    button.classList.toggle("off", hidden);
    if (element === fpvPanel) updateFpvViewport();
  };
});

document.querySelector("[data-toolbar-toggle]").onclick = () => {
  document.querySelector(".ui-toolbar").classList.toggle("collapsed");
};

async function send(command) {
  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command })
    });
    const data = await response.json();
    log(command, data.response || data.error);
  } catch {
    log("ERR", "Backend unavailable");
  }
}

document.querySelectorAll("[data-command]").forEach(button => {
  button.onclick = () => send(button.dataset.command);
});
document.querySelectorAll("[data-repeat]").forEach(button => {
  button.onclick = () => send(button.dataset.repeat);
});
document.querySelector("[data-stream]").onclick = () => {
  send(target.streaming ? "streamoff" : "streamon");
};

$("terminal").onsubmit = event => {
  event.preventDefault();
  const command = $("command").value.trim();
  if (command) {
    send(command);
    $("command").value = "";
  }
};

const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
socket.onopen = () => {
  $("connection").textContent = "SIM ONLINE";
  $("connection").classList.add("online");
};
socket.onclose = () => {
  $("connection").textContent = "OFFLINE";
  $("connection").classList.remove("online");
};
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.type !== "state") return;
  target = message.data;
  $("fpv").classList.toggle("active", target.streaming);
  $("fpv").querySelector("em").textContent = target.streaming ? "STREAMING" : "READY";
  document.querySelector("[data-stream]").textContent = target.streaming ? "STOP STREAM" : "VIDEO STREAM";
  $("height").textContent = `${target.y.toFixed(2)} m`;
  $("battery").textContent = `${Math.round(target.battery)}%`;
  const seconds = Math.round(target.flightTime);
  $("time").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  $("yaw").textContent = `${String(Math.round(target.yaw)).padStart(3, "0")}°`;
  $("speed").textContent = `${Math.hypot(target.vx, target.vy, target.vz).toFixed(2)} m/s`;
  $("coords").textContent = `X ${target.x.toFixed(2)}   Y ${target.y.toFixed(2)}   Z ${target.z.toFixed(2)}`;
};

let encoder = null;
let videoTimer = null;
let frameNumber = 0;

function stopVideo() {
  if (videoTimer) {
    clearInterval(videoTimer);
    videoTimer = null;
  }
  if (encoder) {
    encoder.flush().catch(() => {}).finally(() => encoder.close());
    encoder = null;
  }
}

async function startVideo() {
  if (encoder || typeof VideoEncoder === "undefined") return;
  const config = {
    codec: "avc1.42001f",
    width: 960,
    height: 720,
    bitrate: 2500000,
    framerate: 20,
    avc: { format: "annexb" },
    latencyMode: "realtime"
  };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) return;
  encoder = new VideoEncoder({
    output: chunk => {
      if (socket.readyState !== WebSocket.OPEN) return;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      socket.send(data);
    },
    error: () => stopVideo()
  });
  encoder.configure(config);

  const capture = document.createElement("canvas");
  capture.width = 960;
  capture.height = 720;
  const context = capture.getContext("2d");
  videoTimer = setInterval(() => {
    if (!target.streaming || !encoder || encoder.encodeQueueSize > 2) return;
    const sx = fpvViewport.x * canvas.width / canvas.clientWidth;
    const sy = fpvViewport.y * canvas.height / canvas.clientHeight;
    const sw = fpvViewport.width * canvas.width / canvas.clientWidth;
    const sh = fpvViewport.height * canvas.height / canvas.clientHeight;
    context.drawImage(canvas, sx, sy, sw, sh, 0, 0, 960, 720);
    const frame = new VideoFrame(capture, { timestamp: Math.round(performance.now() * 1000) });
    encoder.encode(frame, { keyFrame: frameNumber++ % 40 === 0 });
    frame.close();
  }, 50);
}

setInterval(() => {
  if (target.streaming) startVideo();
  else stopVideo();
}, 250);

window.addEventListener("resize", () => {
  app.resizeCanvas();
  updateFpvViewport();
});
