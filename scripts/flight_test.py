#!/usr/bin/env python3

import argparse
from datetime import datetime
from pathlib import Path
import socket
import shutil
import struct
import subprocess
import sys
import threading
import time
import zlib


WIDTH = 960
HEIGHT = 720
FRAME_SIZE = WIDTH * HEIGHT * 3


def write_png(path, frame):
    rows = b"".join(b"\x00" + frame[offset:offset + WIDTH * 3] for offset in range(0, len(frame), WIDTH * 3))
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xffffffff)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows, 6)) + chunk(b"IEND", b""))


def read_frame(stream):
    data = bytearray()
    while len(data) < FRAME_SIZE:
        block = stream.read(FRAME_SIZE - len(data))
        if not block:
            return None
        data.extend(block)
    return bytes(data)


def relay_frames(decoder, player, result, requested, ready):
    capture_count = 0
    while True:
        frame = read_frame(decoder.stdout)
        if frame is None:
            break
        if player and player.stdin:
            try:
                player.stdin.write(frame)
                player.stdin.flush()
            except BrokenPipeError:
                player = None
        if requested.is_set():
            capture_count += 1
        if capture_count == 10:
            values = frame[::97]
            brightness = sum(values) / len(values)
            contrast = max(values) - min(values)
            output = Path(__file__).resolve().parent.parent / "temp"
            output.mkdir(exist_ok=True)
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
            path = output / f"fpv_{timestamp}.png"
            write_png(path, frame)
            result.update(path=path, brightness=brightness, contrast=contrast, valid=brightness > 3 and contrast > 8)
            ready.set()


def send(client, target, command, timeout=3.0):
    client.settimeout(timeout)
    client.sendto(command.encode(), target)
    response, _ = client.recvfrom(1024)
    result = response.decode().strip()
    print(f"{command:<18} {result}")
    if result.startswith("error"):
        raise RuntimeError(f"Command failed: {command}: {result}")
    return result


def run(host, port, time_scale, show_video):
    target = (host, port)
    client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    route = [
        ("speed 100", 0.1),
        ("takeoff", 2.4),
        ("up 50", 1.7),
        ("forward 150", 2.4),
        ("right 250", 3.4),
        ("cw 90", 1.8),
        ("forward 200", 2.9),
        ("ccw 90", 1.8),
        ("left 250", 3.4),
        ("back 150", 2.4),
    ]
    airborne = False
    player = None
    decoder = None
    relay = None
    frame_result = {}
    frame_requested = threading.Event()
    frame_ready = threading.Event()
    try:
        print(f"OFLSim flight test on {host}:{port}")
        send(client, target, "command")
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            raise RuntimeError("ffmpeg is required to validate the FPV stream")
        if show_video:
            ffplay = shutil.which("ffplay")
            if not ffplay:
                raise RuntimeError("ffplay is required to display the FPV stream")
            player = subprocess.Popen([ffplay, "-loglevel", "error", "-f", "rawvideo", "-pixel_format", "rgb24", "-video_size", "960x720", "-framerate", "20", "-window_title", "OFLSim FPV", "pipe:0"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        source = "udp://0.0.0.0:11111?fifo_size=1000000&overrun_nonfatal=1"
        decoder = subprocess.Popen([ffmpeg, "-loglevel", "error", "-f", "h264", "-i", source, "-an", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        relay = threading.Thread(target=relay_frames, args=(decoder, player, frame_result, frame_requested, frame_ready), daemon=True)
        relay.start()
        time.sleep(0.5)
        send(client, target, "streamon")
        time.sleep(0.5 * time_scale)
        for command, delay in route:
            send(client, target, command)
            airborne = airborne or command == "takeoff"
            time.sleep(delay * time_scale)
            if command == "up 50":
                frame_requested.set()
                if not frame_ready.wait(5):
                    raise RuntimeError("No decoded FPV frame received within 5 seconds")
                if not frame_result.get("valid"):
                    raise RuntimeError("The captured FPV frame is black or has no visible contrast")
                print(f"FPV frame saved     {frame_result['path']}")
                print(f"FPV image check     brightness={frame_result['brightness']:.1f} contrast={frame_result['contrast']}")
        battery = int(send(client, target, "battery?"))
        height = int(send(client, target, "height?"))
        if battery <= 0 or height < 20:
            raise RuntimeError(f"Invalid telemetry: battery={battery}, height={height}")
        send(client, target, "land")
        airborne = False
        time.sleep(2.4 * time_scale)
        send(client, target, "streamoff")
        print("Flight test completed successfully")
    except Exception:
        if airborne:
            try:
                send(client, target, "land", 1.0)
            except Exception:
                pass
        try:
            send(client, target, "streamoff", 1.0)
        except Exception:
            pass
        raise
    finally:
        if player:
            player.terminate()
            try:
                player.wait(timeout=2)
            except subprocess.TimeoutExpired:
                player.kill()
            if player.stdin:
                player.stdin.close()
        if decoder:
            decoder.terminate()
            try:
                decoder.wait(timeout=2)
            except subprocess.TimeoutExpired:
                decoder.kill()
        if relay:
            relay.join(timeout=2)
        client.close()


def main():
    parser = argparse.ArgumentParser(description="Fly a test route through OFLSim")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8889)
    parser.add_argument("--time-scale", type=float, default=1.0)
    parser.add_argument("--no-video-window", action="store_true")
    args = parser.parse_args()
    if args.time_scale <= 0:
        parser.error("--time-scale must be greater than zero")
    try:
        run(args.host, args.port, args.time_scale, not args.no_video_window)
    except Exception as error:
        print(f"Flight test failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
