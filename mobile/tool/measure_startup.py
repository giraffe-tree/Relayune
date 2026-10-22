#!/usr/bin/env python3
"""Measure installed Debug app process restarts without inspecting user data.

Acquire the simulator coordinator ticket and project lease before invocation.
Only fixed startup markers are persisted. iOS standalone Flutter output uses
unified logging. Event timestamps exclude log delivery latency; observed arrival
and Dart timings are reported separately.
"""
import argparse
from datetime import datetime
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--device', required=True)
parser.add_argument('--samples', type=int, default=5)
parser.add_argument('--output', required=True)
args = parser.parse_args()
if args.device == 'booted' or args.samples < 1:
    parser.error('Use an exclusively leased UDID and positive sample count')

samples = []
for run in range(args.samples):
    # Start observing before launch so the first frame cannot race the observer.
    # Stopping this observer does not send a termination signal to the app.
    process = subprocess.Popen([
        'xcrun', 'simctl', 'spawn', args.device, 'log', 'stream',
        '--style', 'ndjson', '--level', 'debug', '--predicate',
        'eventMessage CONTAINS "Relayune startup performance "',
    ], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    selector = selectors.DefaultSelector()
    selector.register(process.stdout, selectors.EVENT_READ)
    stages = {}
    buffer = b''
    try:
        ready = False
        observer_start = time.perf_counter()
        while not ready and time.perf_counter() - observer_start < 5:
            for key, _ in selector.select(timeout=.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    break
                buffer += chunk
                ready = b'Filtering the log data' in buffer
            if process.poll() is not None:
                break
        if not ready:
            raise SystemExit('Unified log observer did not become ready')
        buffer = b''
        start = time.perf_counter()
        launch_wall = time.time()
        subprocess.run([
            'xcrun', 'simctl', 'launch', '--terminate-running-process',
            args.device, 'cn.giraffetree.relayune',
        ], capture_output=True, check=True, timeout=15)
        while len(stages) < 3 and time.perf_counter() - start < 30:
            for key, _ in selector.select(timeout=.1):
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    break
                buffer += chunk
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    try:
                        event = json.loads(line)
                    except ValueError:
                        continue
                    message = event.get('eventMessage', '')
                    marker = 'Relayune startup performance '
                    if marker not in message:
                        continue
                    value = json.loads(message.split(marker, 1)[1])
                    stage = value.get('stage')
                    if stage not in {'first_frame', 'home_interactive', 'recent_list'}:
                        continue
                    marker_wall = datetime.fromisoformat(event['timestamp']).timestamp()
                    if marker_wall < launch_wall:
                        continue
                    stages.setdefault(stage, {
                        'launch_to_marker_ms': (marker_wall - launch_wall) * 1000,
                        'launch_to_observation_ms': (time.perf_counter() - start) * 1000,
                        'dart_elapsed_ms': value['dart_elapsed_ms'],
                    })
            if process.poll() is not None:
                break
    finally:
        selector.close()
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    samples.append({'run': run, 'stages': stages, 'complete': len(stages) == 3})
    # No raw application logs, identities, paths or contents leave this probe.
    print(json.dumps(samples[-1]), flush=True)

Path(args.output).write_text(json.dumps({
    'scope': 'Installed production main entry, iOS simulator Debug; real process '
             'restart with warm OS and app cache, no debugger; native launch to '
             'unified-log event timestamp includes simctl launch overhead; '
             'observation time additionally includes log delivery; excludes device boot',
    'samples': samples,
}, indent=2) + '\n')
if not all(sample['complete'] for sample in samples):
    raise SystemExit('Startup probe missed a required stage; inspect the device separately')
