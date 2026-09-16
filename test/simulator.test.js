import test from "node:test";
import assert from "node:assert/strict";
import { TelloSimulator } from "../server/simulator.js";

function flyingSim() {
  const sim = new TelloSimulator();
  sim.execute("command");
  sim.execute("takeoff");
  return sim;
}

function tick(sim, steps) {
  for (let i = 0; i < steps; i++) sim.tick(0.02);
}

test("requires SDK mode before flight", () => {
  const sim = new TelloSimulator();
  assert.match(sim.execute("takeoff"), /^error/);
  assert.equal(sim.execute("command"), "ok");
  assert.equal(sim.execute("takeoff"), "ok");
});

test("completes takeoff at the target altitude", () => {
  const sim = flyingSim();
  tick(sim, 150);
  assert.ok(Math.abs(sim.snapshot().y - 1.2) < 0.01);
  assert.equal(sim.snapshot().collision, false);
});

test("lands on the floor without returning to minimum flight height", () => {
  const sim = flyingSim();
  tick(sim, 150);
  assert.equal(sim.execute("land"), "ok");
  tick(sim, 200);
  assert.equal(sim.snapshot().y, 0);
  assert.equal(sim.snapshot().height, 0);
  assert.equal(sim.snapshot().flying, false);
  assert.equal(sim.snapshot().collision, false);
});

test("lands on an office desk and takes off relative to its surface", () => {
  const sim = new TelloSimulator();
  sim.state.x = -5;
  sim.state.z = 1;
  sim.execute("command");
  sim.execute("takeoff");
  tick(sim, 150);
  assert.equal(sim.execute("land"), "ok");
  tick(sim, 200);
  assert.ok(Math.abs(sim.snapshot().y - 0.77) < 0.001);
  assert.equal(sim.snapshot().flying, false);
  assert.equal(sim.execute("takeoff"), "ok");
  tick(sim, 150);
  assert.ok(Math.abs(sim.snapshot().y - 1.97) < 0.01);
});

test("moves forward relative to yaw", () => {
  const sim = flyingSim();
  tick(sim, 150);
  const before = sim.snapshot();
  assert.equal(sim.execute("forward 100"), "ok");
  tick(sim, 150);
  assert.ok(sim.snapshot().z < before.z - 0.9);
});

test("moves forward to the right after a clockwise rotation", () => {
  const sim = flyingSim();
  tick(sim, 150);
  sim.execute("cw 90");
  tick(sim, 100);
  const before = sim.snapshot();
  sim.execute("forward 100");
  tick(sim, 150);
  assert.ok(sim.snapshot().x > before.x + 0.9);
  assert.ok(Math.abs(sim.snapshot().z - before.z) < 0.05);
});

test("moves forward to the left after a counterclockwise rotation", () => {
  const sim = flyingSim();
  tick(sim, 150);
  sim.execute("ccw 90");
  tick(sim, 100);
  const before = sim.snapshot();
  sim.execute("forward 100");
  tick(sim, 150);
  assert.ok(sim.snapshot().x < before.x - 0.9);
  assert.ok(Math.abs(sim.snapshot().z - before.z) < 0.05);
});

test("accelerates and brakes during yaw rotation", () => {
  const sim = flyingSim();
  tick(sim, 150);
  sim.execute("cw 90");
  sim.tick(0.02);
  assert.ok(sim.snapshot().yaw > 359.8);
  assert.ok(sim.snapshot().yawRate < 0);
  assert.ok(Math.abs(sim.snapshot().yawRate) < 100);
  tick(sim, 100);
  assert.ok(Math.abs(sim.snapshot().yaw - 270) < 0.01);
  assert.equal(sim.snapshot().yawRate, 0);
});

test("reports velocity and tilt while accelerating", () => {
  const sim = flyingSim();
  tick(sim, 150);
  sim.execute("forward 100");
  tick(sim, 10);
  assert.ok(sim.snapshot().vz < 0);
  assert.ok(sim.snapshot().pitch < -1);
  assert.match(sim.telemetry(), /pitch:-?\d+;roll:-?\d+;/);
});

test("banks into the direction of left and right flight", () => {
  const sim = flyingSim();
  tick(sim, 150);
  sim.execute("right 100");
  tick(sim, 10);
  assert.ok(sim.snapshot().roll < -1);
  sim.execute("stop");
  tick(sim, 80);
  sim.execute("left 100");
  tick(sim, 10);
  assert.ok(sim.snapshot().roll > 1);
});

test("reports Tello-compatible telemetry", () => {
  const sim = new TelloSimulator();
  assert.match(sim.telemetry(), /pitch:0;roll:0;yaw:0;/);
  assert.match(sim.execute("battery?"), /^\d+$/);
});

test("controls the simulated FPV stream", () => {
  const sim = new TelloSimulator();
  assert.match(sim.execute("streamon"), /^error/);
  sim.execute("command");
  assert.equal(sim.execute("streamon"), "ok");
  assert.equal(sim.snapshot().streaming, true);
  assert.equal(sim.execute("streamoff"), "ok");
  assert.equal(sim.snapshot().streaming, false);
});

test("supports mission pad detection and telemetry", () => {
  const sim = new TelloSimulator();
  sim.execute("command");
  assert.equal(sim.execute("mon"), "ok");
  assert.equal(sim.execute("mdirection 0"), "ok");
  sim.state.x = -7;
  sim.state.z = -4;
  sim.state.y = 1;
  assert.match(sim.telemetry(), /^mid:1;x:0;y:0;z:100;/);
  assert.equal(sim.execute("moff"), "ok");
  assert.doesNotMatch(sim.telemetry(), /^mid:/);
});

test("validates network, motor, and sensor commands", () => {
  const sim = new TelloSimulator();
  sim.execute("command");
  assert.equal(sim.execute("wifi office secret"), "ok");
  assert.equal(sim.execute("ap network password"), "ok");
  assert.equal(sim.execute("motoron"), "ok");
  assert.equal(sim.snapshot().motorsRunning, true);
  assert.equal(sim.execute("motoroff"), "ok");
  assert.equal(sim.execute("acceleration?"), "0.00;0.00;-1000.00;");
  assert.equal(sim.execute("sdk?"), "20");
});

test("executes curve, jump, and flip commands", () => {
  const sim = flyingSim();
  tick(sim, 150);
  assert.equal(sim.execute("curve 50 0 0 100 50 0 40"), "ok");
  tick(sim, 400);
  assert.equal(sim.execute("jump 20 0 100 50 90 m1 m2"), "ok");
  for (let i = 0; i < 2000 && sim.motion; i++) sim.tick(0.02);
  assert.equal(sim.motion, null);
  assert.equal(sim.execute("flip f"), "ok");
  sim.tick(0.2);
  assert.notEqual(sim.snapshot().flipPitch, 0);
  tick(sim, 40);
  assert.equal(sim.snapshot().flipPitch, 0);
});
