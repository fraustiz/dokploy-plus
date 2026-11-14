"""Read-only Docker inventory, container incidents and host disk samples."""
import http.client
import socket
import json
import os
import time
import threading
from pathlib import Path
from urllib.parse import quote

STATE = Path(os.environ.get('STATE_DIR', '/state'))
SOCKET = os.environ.get('DOCKER_SOCK', '/var/run/docker.sock')
_lock = threading.Lock()
_data = {'apps': [], 'events': [], 'history': [], 'containers': [], 'services': None, 'docker_error': None}
_previous = {}
_services_prev = {}
_previous_io = None

def docker(path, method="GET"):
    conn = http.client.HTTPConnection('localhost', timeout=15)
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(15)
    sock.connect(SOCKET)
    conn.sock = sock
    try:
        conn.request(method, path)
        res = conn.getresponse()
        if res.status not in (200, 204):
            raise OSError('Docker HTTP ' + str(res.status))
        body = res.read()
        return json.loads(body) if body else None
    finally:
        conn.close()

def group(labels, name):
    return (labels.get('dokploy.application') or labels.get('com.docker.compose.project')
            or labels.get('com.docker.swarm.service.name') or name)

def inventory():
    df = docker('/system/df')
    containers = docker('/containers/json?all=true')
    groups, known = {}, {}
    for c in containers:
        name = (c.get('Names') or [c['Id'][:12]])[0].lstrip('/')
        app = group(c.get('Labels') or {}, name)
        known[c['Id']] = app
        groups.setdefault(app, {'name': app, 'containers': [], 'writable_bytes': 0, 'images': set(), 'volumes': set()})
    sizes = {c['Id']: c.get('SizeRw', 0) or 0 for c in df.get('Containers') or []}
    current = {}
    now = time.time()
    for c in containers:
        name = (c.get('Names') or [c['Id'][:12]])[0].lstrip('/')
        app = known[c['Id']]
        info = docker('/containers/' + quote(c['Id'], safe='') + '/json')
        state = info.get('State') or {}
        health = (state.get('Health') or {}).get('Status')
        # Only retain operational fields; never expose environment, mounts' host paths or labels.
        item = {'id': c['Id'], 'name': name, 'app': app, 'state': state.get('Status'),
                'health': health, 'restarts': info.get('RestartCount', 0), 'oom': bool(state.get('OOMKilled'))}
        current[c['Id']] = item
        g = groups[app]
        g['containers'].append(name)
        g['writable_bytes'] += sizes.get(c['Id'], 0)
        g['images'].add(c.get('ImageID'))
        for m in info.get('Mounts') or []:
            if m.get('Type') == 'volume':
                g['volumes'].add(m.get('Name'))
        previous = _previous.get(c['Id'])
        issues = []
        if health == 'unhealthy': issues.append('unhealthy')
        if item['oom']: issues.append('oom')
        if previous and item['restarts'] > previous['restarts']: issues.append('restart')
        if item['state'] in ('exited', 'dead', 'restarting'): issues.append('stopped')
        prior_issues = previous.get('issues', []) if previous else []
        for issue in issues:
            if issue not in prior_issues or issue == 'restart':
                _data['events'].append({'at': now, 'app': app, 'container': name, 'kind': issue, 'resolved': False})
        if previous and prior_issues and not issues:
            _data['events'].append({'at': now, 'app': app, 'container': name, 'kind': 'recovered', 'resolved': True})
        item['issues'] = issues
    _previous.clear()
    _previous.update(current)
    images = {i['Id']: i.get('Size', 0) or 0 for i in df.get('Images') or []}
    volumes = {v['Name']: max(0, (v.get('UsageData') or {}).get('Size', 0)) for v in df.get('Volumes') or []}
    for g in groups.values():
        g['image_bytes'] = sum(images.get(i, 0) for i in g['images'])
        g['volume_bytes'] = sum(volumes.get(v, 0) for v in g['volumes'])
        g['images'] = sorted(i for i in g['images'] if i)
        g['volumes'] = sorted(v for v in g['volumes'] if v)
    unused_images = [i for i in df.get('Images') or [] if i.get('Containers', 0) == 0]
    unused_volumes = [v for v in df.get('Volumes') or [] if (v.get('UsageData') or {}).get('RefCount') == 0]
    if unused_images or unused_volumes:
        groups['Unassigned resources'] = {'name': 'Unassigned resources', 'containers': [], 'writable_bytes': 0,
            'images': [i['Id'] for i in unused_images], 'volumes': [v['Name'] for v in unused_volumes],
            'image_bytes': sum(i.get('Size', 0) or 0 for i in unused_images),
            'volume_bytes': sum(max(0, (v.get('UsageData') or {}).get('Size', 0)) for v in unused_volumes)}
    cache = df.get('BuildCache') or []
    groups['Build cache (global)'] = {'name': 'Build cache (global)', 'containers': [], 'writable_bytes': sum(b.get('Size', 0) for b in cache), 'images': [], 'volumes': [], 'image_bytes': 0, 'volume_bytes': 0}
    apps = sorted(groups.values(), key=lambda g: g['volume_bytes'] + g['writable_bytes'] + g['image_bytes'], reverse=True)
    _data.update(apps=apps, containers=list(current.values()), docker_error=None)
    _data['events'] = _data['events'][-500:]

def sample():
    global _previous_io
    now = time.time()
    disks = {}
    for dev in Path('/sys/block').glob('*'):
        if dev.name.startswith(('loop', 'ram', 'zram', 'dm-', 'md', 'sr', 'fd')):
            continue
        try:
            fields = [int(v) for v in (dev/'stat').read_text().split()]
            disks[dev.name] = {'reads': fields[0], 'read_sectors': fields[2], 'read_ms': fields[3],
                               'writes': fields[4], 'write_sectors': fields[6], 'write_ms': fields[7], 'busy_ms': fields[9]}
        except (OSError, ValueError, IndexError):
            continue
    io = []
    if _previous_io:
        elapsed = now - _previous_io['at']
        if elapsed > 0:
            for name, v in disks.items():
                prev = _previous_io['disks'].get(name)
                if not prev or any(v[k] < prev[k] for k in v):
                    continue
                d = {k: v[k]-prev[k] for k in v}
                ops = d['reads']+d['writes']
                io.append({'name': name, 'read_bps': d['read_sectors']*512/elapsed, 'write_bps': d['write_sectors']*512/elapsed,
                           'latency_ms': (d['read_ms']+d['write_ms'])/ops if ops else 0,
                           'busy_pct': min(100, d['busy_ms']/elapsed/10)})
    _previous_io = {'at': now, 'disks': disks}
    pressure = None
    try:
        fields = Path('/proc/pressure/memory').read_text().splitlines()[0].split()
        pressure = float(next(v.split('=')[1] for v in fields if v.startswith('avg10=')))
    except (OSError, StopIteration, ValueError, IndexError):
        pass
    _data['history'].append({'at': now, 'disks': io, 'memory_pressure_pct': pressure})
    _data['history'] = _data['history'][-1440:]

def swarm():
    """Replicated Swarm services running fewer tasks than requested (e.g. an image that disappeared).

    Container checks cannot see this case: no container exists. An incident is raised after two
    checks in a row (about 2 minutes) so that a normal redeploy does not trigger it.
    """
    try:
        services = docker('/services')
        tasks = docker('/tasks?filters=' + quote(json.dumps({'desired-state': ['running']})))
    except (OSError, ValueError):
        _data['services'] = None  # not a Swarm manager, or no Docker access
        return
    now = time.time()
    out = []
    for svc in services or []:
        spec = svc.get('Spec') or {}
        replicated = (spec.get('Mode') or {}).get('Replicated')
        if not replicated:
            continue
        name = spec.get('Name') or svc['ID'][:12]
        mine = sorted((t for t in tasks or [] if t.get('ServiceID') == svc['ID']), key=lambda t: t.get('UpdatedAt', ''), reverse=True)
        running = sum(1 for t in mine if (t.get('Status') or {}).get('State') == 'running')
        desired = replicated.get('Replicas') or 0
        error = next(((t.get('Status') or {}).get('Err') for t in mine if (t.get('Status') or {}).get('Err')), None)
        prev = _services_prev.get(name) or {}
        streak = prev.get('streak', 0) + 1 if running < desired else 0
        item = {'name': name, 'desired': desired, 'running': running, 'streak': streak,
                'error': error[:300] if error and running < desired else None,
                'since': (prev.get('since') or now) if running < desired else None}
        if streak == 2:
            _data['events'].append({'at': now, 'app': name, 'container': name, 'kind': 'service-down', 'resolved': False})
        elif streak == 0 and prev.get('streak', 0) >= 2:
            _data['events'].append({'at': now, 'app': name, 'container': name, 'kind': 'recovered', 'resolved': True})
        out.append(item)
    _services_prev.clear()
    _services_prev.update({i['name']: i for i in out})
    _data['services'] = sorted(out, key=lambda i: (i['running'] >= i['desired'], i['name']))

def snapshot():
    with _lock:
        return json.loads(json.dumps(_data))

def start():
    try:
        saved = json.loads((STATE/'insights.json').read_text())
        _data['events'] = saved.get('events', [])[-500:]
        _data['history'] = saved.get('history', [])[-1440:]
        _previous.update({c['id']: c for c in saved.get('containers', [])})
        _services_prev.update({s['name']: s for s in saved.get('services') or []})
    except (OSError, ValueError):
        pass
    def loop():
        while True:
            with _lock:
                try: inventory()
                except Exception as e: _data['docker_error'] = str(e)
                try: swarm()
                except Exception: _data['services'] = None
                _data['events'] = _data['events'][-500:]
                sample()
                try:
                    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
                    tmp = STATE/'insights.json.tmp'
                    tmp.write_text(json.dumps(_data))
                    tmp.replace(STATE/'insights.json')
                except OSError:
                    pass
            time.sleep(60)
    threading.Thread(target=loop, daemon=True).start()
