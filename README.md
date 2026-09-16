# OFLSim

**Office Flight Lab** — a local Tello-compatible drone simulator. Fly through a PlayCanvas office from the browser or from existing Tello SDK clients over UDP.

## Requirements

- Node.js 20 or newer
- pnpm 9 or newer
- A modern browser with WebGL
- UDP ports `8889`, `8890`, and `11111` free if you want to talk to it like a real Tello
- `ffmpeg` and `ffplay` if you run the Python flight test with the FPV window
- Python 3 and `djitellopy` if you run the SDK smoke test (`pip install -r scripts/requirements.txt`)

## Install and run

```bash
pnpm install
pnpm start
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm dev     # restart on server changes
pnpm test
```

| Variable | Default | Purpose |
| --- | ---: | --- |
| `PORT` | `3000` | HTTP and WebSocket |
| `TELLO_PORT` | `8889` | UDP command port |

```bash
PORT=4000 TELLO_PORT=9000 pnpm start
```

## Browser controls

1. Click **SDK MODE** or type `command`.
2. Click **TAKE OFF**.
3. Use the pads or type Tello commands in the terminal.
4. Click **LAND** when you’re done.
5. Click **RESET** to put the drone back at the start pad and restore the initial SDK, battery, and stream state.

Drag the scene to look around. `WASD` moves, `Q`/`E` go down/up, `Shift` speeds you up, scroll changes the camera speed.

The main view stays third-person. The FPV panel is the forward camera; `streamon` / `streamoff` only affect the network stream, not the panel itself.

The toolbar at the top toggles telemetry, controls, help, and FPV. The header stays visible. `UI` collapses the toolbar. Drag the FPV title bar to move the camera view.

## Flight dynamics

The server owns position, velocity, yaw rate, pitch, and roll. Movement commands accelerate toward their speed and brake based on remaining distance. Yaw does the same, so heading changes take time instead of snapping.

SDK speed is 10–100 cm/s, `rc` is -100–100, product max speed is 8 m/s, and visual tilt is 9° in slow mode / 25° in fast mode. Distance commands use the configured SDK speed and a 9° tilt.

The real aircraft’s controller gains aren’t public, so the model uses approximations: 1.8 m/s² horizontal, 1.2 m/s² vertical, 180 deg/s² yaw, 100 deg/s yaw-rate limit. It looks continuous. It is not a hardware-identical aero model.

## Interfaces

| Interface | Address | Purpose |
| --- | --- | --- |
| Web app | `http://localhost:3000` | 3D scene and controls |
| HTTP API | `http://localhost:3000/api` | Commands, state, reset, telemetry |
| WebSocket | `ws://localhost:3000/ws` | Live state ~20 Hz |
| Tello UDP commands | `udp://localhost:8889` | Tello SDK text commands |
| Tello UDP state | `udp://<client-address>:8890` | Telemetry ~10 Hz |
| Tello video | `udp://<client-address>:11111` | 960×720 H.264 Annex B FPV |

## HTTP API

### `POST /api/command`

Send `command` before any flight command.

```bash
curl -X POST http://localhost:3000/api/command \
  -H 'Content-Type: application/json' \
  -d '{"command":"command"}'

curl -X POST http://localhost:3000/api/command \
  -H 'Content-Type: application/json' \
  -d '{"command":"takeoff"}'
```

```json
{
  "command": "takeoff",
  "response": "ok",
  "state": {
    "sdkMode": true,
    "flying": true,
    "x": -5,
    "y": 0,
    "z": 3,
    "yaw": 0,
    "pitch": 0,
    "roll": 0,
    "yawRate": 0,
    "battery": 100
  }
}
```

Invalid commands return HTTP `400` with a Tello-style error in `response`.

### `GET /api/state`

Position, velocity, orientation, battery, flight time, temperature, SDK state, last command.

```bash
curl http://localhost:3000/api/state
```

### `GET /api/telemetry`

The semicolon-delimited string Tello clients expect.

```bash
curl http://localhost:3000/api/telemetry
```

### `POST /api/reset`

Back to the start pad: position, battery, timers, SDK mode, motion.

```bash
curl -X POST http://localhost:3000/api/reset
```

## WebSocket API

Connect to `ws://localhost:3000/ws`. No subscribe message needed.

```json
{
  "type": "state",
  "data": {
    "sdkMode": true,
    "flying": true,
    "x": -5,
    "y": 1.2,
    "z": 3,
    "yaw": 0,
    "vx": 0,
    "vy": 0,
    "vz": 0,
    "battery": 99.8,
    "flightTime": 12.4
  }
}
```

## Tello UDP API

Send UTF-8 commands to UDP port `8889`. Replies go back to the sender’s source port. After the first packet, telemetry goes to port `8890` on that address.

| Command | Arguments | Behavior |
| --- | --- | --- |
| `command` | none | Enter SDK mode |
| `keepalive` | none | Reset the 15-second SDK landing timer |
| `streamon`, `streamoff` | none | Enable or disable the simulated FPV camera |
| `takeoff` | none | Take off to about 1.2 m |
| `land` | none | Land on the floor or the table under the drone |
| `emergency` | none | Stop and drop to floor level |
| `stop` | none | Cancel the current move |
| `speed x` | `10-100` cm/s | Set movement speed |
| `up x`, `down x` | `20-500` cm | Change altitude |
| `left x`, `right x` | `20-500` cm | Strafe relative to yaw |
| `forward x`, `back x` | `20-500` cm | Move relative to yaw |
| `cw x`, `ccw x` | `1-360` degrees | Yaw |
| `go x y z speed [mid]` | cm and cm/s | Relative or Mission Pad target |
| `curve x1 y1 z1 x2 y2 z2 speed [mid]` | cm and cm/s | Quadratic curve with radius check |
| `jump x y z speed yaw mid1 mid2` | coords + two pad IDs | Move between pad frames |
| `rc lr fb ud yaw` | each `-100-100` | Stick input, expires after 500 ms |
| `flip l/r/f/b` | direction | Visible flip |
| `mon`, `moff` | none | Mission Pad detection on/off |
| `mdirection x` | `0`, `1`, or `2` | Down, forward, or both cameras |
| `wifi ssid pass` | credentials | Simulated Wi-Fi config |
| `ap ssid pass` | credentials | Simulated station mode |
| `motoron`, `motoroff` | none | Spin motors on the ground |

Queries: `battery?`, `time?`, `speed?`, `height?`, `temp?`, `attitude?`, `baro?`, `tof?`, `wifi?`, `acceleration?`, `sn?`, `sdk?`.

Discrete moves return a busy error until they finish. `stop` and `emergency` still work. UDP and HTTP hold the `ok` until the move actually completes, like a real Tello. If nothing arrives for 15 seconds in the air, or battery hits 10%, it lands on whatever surface is underneath. `keepalive` resets that timer.

Walls, glass, desks, chairs, the conference table, sofa, and plants are solid. Hitting one stops the aircraft and drops it onto the surface below. `tof?` / `height?` report the downward distance to that surface, not the absolute altitude.

Mission Pad telemetry adds `mid`, `x`, `y`, `z`, and `mpry`. The office has pads `m1`–`m8`. `wifi` / `ap` only change simulator state, not the host network.

### Python example

```python
import socket

client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
client.settimeout(5)

for command in ["command", "takeoff", "forward 100", "cw 90", "land"]:
    client.sendto(command.encode(), ("127.0.0.1", 8889))
    response, _ = client.recvfrom(1024)
    print(command, response.decode())
```

### RC stick input

An `rc` packet expires after 500 ms. Repeat it at 10–20 Hz for continuous control.

```python
import socket
import time

client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
target = ("127.0.0.1", 8889)

for command in [b"command", b"takeoff"]:
    client.sendto(command, target)
    client.recvfrom(1024)

for _ in range(40):
    client.sendto(b"rc 0 40 0 0", target)
    client.recvfrom(1024)
    time.sleep(0.05)

client.sendto(b"rc 0 0 0 0", target)
client.recvfrom(1024)
```

## Layout

```text
public/               Browser app and PlayCanvas scene
server/index.js       HTTP, WebSocket, UDP
server/simulator.js   Commands, physics, telemetry
test/                 Unit tests
```

This is not a complete Tello SDK 3.0 clone. The public SDK 2.0 flight path works; some firmware-specific responses and extra maps are still missing.

## Office flight test

Keep the simulator page open, then:

```bash
python3 scripts/flight_test.py
```

It turns on the H.264 stream, decodes with `ffmpeg`, optionally shows `ffplay`, saves a PNG under `temp/`, rejects black frames, flies a loop around the office, checks telemetry, lands, and stops the stream. The browser has to stay open because PlayCanvas is the renderer. `--no-video-window` is for CI; `--host` / `--port` if the server isn’t on the defaults.

## SDK smoke test

Keep the simulator running, then:

```bash
pip install -r scripts/requirements.txt
python3 scripts/sdk_smoke_test.py
```

This talks to OFLSim through [djitellopy](https://github.com/damiafuentes/DJITelloPy): `connect`, takeoff, state telemetry on port `8890`, a short move, `streamon` / `streamoff`, and land. It does not decode FPV frames, so the browser tab is optional. `--host` / `--port` / `--http-port` if the server isn’t on the defaults.
