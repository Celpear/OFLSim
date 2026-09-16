#!/usr/bin/env python3
"""Smoke-test OFLSim through djitellopy, the usual Python Tello SDK."""

import argparse
import logging
import socket
import sys
from urllib.request import Request, urlopen


def allow_localhost_client(command_port):
    """djitellopy binds UDP 8889, the same port OFLSim listens on.

    A real Tello is a different host, so both sides can use 8889. On
    localhost that collides. Bind an ephemeral port instead; the simulator
    already replies to the client's source port.
    """
    original = socket.socket.bind

    def bind(sock, address):
        if isinstance(address, tuple) and len(address) >= 2 and address[1] == command_port:
            address = (address[0], 0)
        return original(sock, address)

    socket.socket.bind = bind


def reset_simulator(host, http_port):
    urlopen(Request(f"http://{host}:{http_port}/api/reset", method="POST"), timeout=3)


def step(name, value="ok"):
    print(f"{name:<18} {value}")


def run(host, port, http_port):
    try:
        from djitellopy import Tello
        from djitellopy.tello import TelloException
    except ImportError:
        raise RuntimeError("djitellopy is missing; pip install -r scripts/requirements.txt")

    host = socket.gethostbyname(host)
    Tello.CONTROL_UDP_PORT = port
    Tello.LOGGER.setLevel(logging.WARNING)
    allow_localhost_client(port)

    print(f"OFLSim SDK smoke test on {host}:{port}")
    try:
        reset_simulator(host, http_port)
        step("reset")
    except Exception as error:
        step("reset", f"skip ({error.__class__.__name__})")

    tello = Tello(host=host)
    airborne = False
    try:
        tello.connect()
        step("connect")

        battery = tello.get_battery()
        sdk = tello.query_sdk_version()
        step("battery", f"{battery}%")
        step("sdk?", sdk)
        if battery <= 0:
            raise RuntimeError(f"Invalid battery telemetry: {battery}")
        if str(sdk).strip() != "20":
            raise RuntimeError(f"Unexpected SDK version: {sdk}")

        tello.takeoff()
        airborne = True
        step("takeoff")

        height = tello.get_height()
        tof = tello.get_distance_tof()
        step("height", f"{height} cm")
        step("tof", f"{tof} cm")
        if height < 20:
            raise RuntimeError(f"Invalid height after takeoff: {height} cm")

        tello.move_up(30)
        step("move_up 30")
        tello.rotate_clockwise(45)
        step("cw 45")

        tello.streamon()
        step("streamon")
        tello.streamoff()
        step("streamoff")

        tello.land()
        airborne = False
        step("land")
        print("SDK smoke test completed successfully")
    except TelloException as error:
        raise RuntimeError(error) from error
    finally:
        try:
            if airborne:
                tello.land()
        except Exception:
            pass
        tello.end()


def main():
    parser = argparse.ArgumentParser(description="Smoke-test OFLSim with the Python Tello SDK")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8889)
    parser.add_argument("--http-port", type=int, default=3000)
    args = parser.parse_args()
    try:
        run(args.host, args.port, args.http_port)
    except Exception as error:
        print(f"SDK smoke test failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
