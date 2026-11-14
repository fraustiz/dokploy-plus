"""Dokploy Plus — storage agent.

Read-only collector for the host it runs on. It collects host data and permits only explicit, authenticated cleanup of old
untagged Docker images (no disk, filesystem or volume mutations). Status endpoint: one internal HTTP endpoint, reachable only by the Dokploy Plus proxy.

  GET /health  -> {"ok": true}
  GET /status  -> RAID arrays (mdadm), disks (+ SMART when available), filesystems,
                  memory/swap and Docker disk usage (when the Docker socket is mounted).

Everything is auto-detected, so the same image works on a bare-metal NAS (mdadm + SMART,
container run with `privileged: true`) and on a cloud VPS (virtual disk, no SMART).
"""

import cleanup
import insights
import glob
import http.client
import json
import os
import re
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SYS_BLOCK = "/sys/block"
HOST_LABEL = os.environ.get("HOST_LABEL") or ""
# "label=path" pairs: displayed mount point = any file or directory of that filesystem inside the
# container (statvfs only). Default: the host root filesystem, through the mounted /etc/hostname.
VOLUMES = [tuple(v.strip().split("=", 1)) for v in os.environ.get("VOLUMES", "/=/host/etc/hostname").split(",") if "=" in v]
SMART_MODE = os.environ.get("SMART", "auto").lower()  # auto | off
SMART_TTL = int(os.environ.get("SMART_TTL", "300"))
DOCKER_SOCK = os.environ.get("DOCKER_SOCK", "/var/run/docker.sock")
DOCKER_TTL = int(os.environ.get("DOCKER_TTL", "300"))
PORT = int(os.environ.get("PORT", "8080"))

SKIP_DISK = re.compile(r"^(loop|ram|zram|md|dm-|sr|nbd|fd)")
WATCHED_ATTRS = {5: "reallocated", 187: "uncorrectable", 197: "pending", 198: "offline_uncorrectable", 199: "crc"}

_lock = threading.Lock()
_smart = {}       # disk -> {"data":..., "at":..., "standby": bool}
_docker = {"data": None, "at": 0}


def rd(path, default=None):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def rd_int(path, default=0):
    try:
        return int(rd(path))
    except (TypeError, ValueError):
        return default


def run(cmd, timeout=30):
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout
    except (OSError, subprocess.TimeoutExpired) as e:
        return -1, str(e)


def host_label():
    return HOST_LABEL or rd("/host/etc/hostname") or socket.gethostname()


# ------------------------------------------------------------------ RAID (mdadm)
def md_arrays():
    arrays = []
    for d in sorted(glob.glob(f"{SYS_BLOCK}/md*")):
        md = f"{d}/md"
        if not os.path.isdir(md):
            continue
        name = os.path.basename(d)
        level = rd(f"{md}/level")
        members = [{
            "dev": os.path.basename(dev)[4:],
            "state": rd(f"{dev}/state"),
            "slot": rd(f"{dev}/slot"),
            "errors": rd_int(f"{dev}/errors"),
        } for dev in sorted(glob.glob(f"{md}/dev-*"))]
        sync = {"action": rd(f"{md}/sync_action"), "progress": None}
        completed = rd(f"{md}/sync_completed")
        if completed and "/" in completed:
            done, total = (int(x) for x in completed.split("/"))
            if total:
                sync["progress"] = round(done * 100 / total, 2)
        _, detail = run(["mdadm", "--detail", f"/dev/{name}"])
        arrays.append({
            "name": name, "level": level, "redundant": level not in (None, "raid0", "linear"),
            "state": rd(f"{md}/array_state"), "raid_disks": rd_int(f"{md}/raid_disks"),
            "degraded": rd_int(f"{md}/degraded") if os.path.exists(f"{md}/degraded") else 0,
            "chunk_bytes": rd_int(f"{md}/chunk_size"), "size_bytes": rd_int(f"{d}/size") * 512,
            "devnum": rd(f"{d}/dev"), "sync": sync, "mismatch_cnt": rd_int(f"{md}/mismatch_cnt", None),
            "members": members, "detail": detail if detail.startswith("/dev/") else "",
        })
    return arrays


# ------------------------------------------------------------------ filesystems
def volumes(arrays):
    by_dev = {a["devnum"]: a["name"] for a in arrays}
    out = []
    for label, path in VOLUMES:
        try:
            st = os.statvfs(path)
            dev = os.stat(path).st_dev
        except OSError as e:
            out.append({"mount": label, "error": str(e)})
            continue
        size = st.f_blocks * st.f_frsize
        avail = st.f_bavail * st.f_frsize
        used = size - st.f_bfree * st.f_frsize
        devnum = f"{os.major(dev)}:{os.minor(dev)}"
        out.append({
            "mount": label, "device": by_dev.get(devnum), "devnum": devnum,
            "size_bytes": size, "used_bytes": used, "avail_bytes": avail,
            "used_pct": round(used * 100 / (used + avail), 1) if used + avail else None,
        })
    return out


# ------------------------------------------------------------------ disks + SMART
def list_disks():
    return [os.path.basename(d) for d in sorted(glob.glob(f"{SYS_BLOCK}/*")) if not SKIP_DISK.match(os.path.basename(d))]


def parse_smart(data):
    s = {
        "available": True,
        "passed": (data.get("smart_status") or {}).get("passed"),
        "temperature_c": (data.get("temperature") or {}).get("current"),
        "power_on_hours": (data.get("power_on_time") or {}).get("hours"),
        "power_cycles": data.get("power_cycle_count"),
        "serial": data.get("serial_number"), "firmware": data.get("firmware_version"), "model": data.get("model_name"),
        "attributes": {}, "nvme": None, "self_test": None,
    }
    for a in (data.get("ata_smart_attributes") or {}).get("table", []):
        if a.get("id") in WATCHED_ATTRS:
            s["attributes"][str(a["id"])] = {"key": WATCHED_ATTRS[a["id"]], "raw": (a.get("raw") or {}).get("value")}
    log = data.get("nvme_smart_health_information_log")
    if log:
        s["nvme"] = {k: log.get(k) for k in ("critical_warning", "percentage_used", "media_errors", "unsafe_shutdowns", "available_spare")}
    tests = ((data.get("ata_smart_self_test_log") or {}).get("standard") or {}).get("table") or []
    if tests:
        t = tests[0]
        s["self_test"] = {"type": (t.get("type") or {}).get("string"), "status": (t.get("status") or {}).get("string"),
                          "passed": (t.get("status") or {}).get("passed"), "lifetime_hours": t.get("lifetime_hours")}
    return s


def read_smart(name):
    code, out = run(["smartctl", "-j", "-a", "-n", "standby", f"/dev/{name}"], timeout=60)
    try:
        data = json.loads(out)
    except ValueError:
        return {"available": False, "reason": "no_smartctl"}
    if code >= 0 and code & 0b10 and "standby" in out.lower():
        return {"available": False, "standby": True}
    if code >= 0 and code & 0b11 and not data.get("smart_status"):
        msgs = " ".join(m.get("string", "") for m in (data.get("smartctl") or {}).get("messages", [])).lower()
        reason = "no_access" if ("permission" in msgs or "no such file" in msgs or "operation not permitted" in msgs) else "unsupported"
        return {"available": False, "reason": reason}
    return parse_smart(data)


def refresh_smart():
    if SMART_MODE == "off":
        return
    for name in list_disks():
        s = read_smart(name)
        with _lock:
            prev = _smart.get(name)
            if s.get("standby") and prev and prev["data"].get("available"):
                prev["standby"] = True
                continue
            _smart[name] = {"data": s, "at": time.time(), "standby": bool(s.get("standby"))}


def disks(arrays):
    member_of = {}
    for a in arrays:
        for m in a["members"]:
            base = re.sub(r"p\d+$", "", m["dev"]) if m["dev"].startswith("nvme") else re.sub(r"\d+$", "", m["dev"])
            member_of.setdefault(base, []).append(a["name"])
    out = []
    for name in list_disks():
        d = f"{SYS_BLOCK}/{name}"
        with _lock:
            c = _smart.get(name) or {}
        out.append({
            "name": name, "model": rd(f"{d}/device/model"), "vendor": rd(f"{d}/device/vendor"),
            "size_bytes": rd_int(f"{d}/size") * 512, "rotational": rd(f"{d}/queue/rotational") == "1",
            "virtual": bool(re.search(r"virtio|qemu|vmware|virtual|blockvolume|xen|hyper-v|msft|amazon|google|ebs",
                                      f"{rd(f'{d}/device/model') or ''} {rd(f'{d}/device/vendor') or ''} {os.path.realpath(d)}", re.I)),
            "arrays": member_of.get(name, []),
            "smart": c.get("data"), "smart_at": c.get("at"), "standby": c.get("standby", False),
        })
    return out


# ------------------------------------------------------------------ memory
def memory():
    m = {}
    for line in (rd("/proc/meminfo") or "").splitlines():
        k, _, v = line.partition(":")
        parts = v.split()
        if parts:
            m[k] = int(parts[0]) * 1024
    total, avail = m.get("MemTotal", 0), m.get("MemAvailable", 0)
    st, sf = m.get("SwapTotal", 0), m.get("SwapFree", 0)
    return {"total_bytes": total, "available_bytes": avail, "used_bytes": total - avail,
            "swap_total_bytes": st, "swap_used_bytes": st - sf}


# ------------------------------------------------------------------ Docker (optional socket)
class _UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path, timeout=60):
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self._path)


def refresh_docker():
    if not os.path.exists(DOCKER_SOCK):
        return
    try:
        c = _UnixHTTP(DOCKER_SOCK)
        c.request("GET", "/system/df")
        r = c.getresponse()
        if r.status != 200:
            return
        df = json.loads(r.read())
    except (OSError, ValueError, http.client.HTTPException):
        return
    images = df.get("Images") or []
    containers = df.get("Containers") or []
    vols = df.get("Volumes") or []
    cache = df.get("BuildCache") or []
    data = {
        "images": {"count": len(images), "size_bytes": df.get("LayersSize") or sum(i.get("Size", 0) for i in images),
                   "reclaimable_bytes": sum(max(0, i.get("Size", 0) - max(0, i.get("SharedSize", 0))) for i in images if i.get("Containers", 0) == 0),
                   "unused": sum(1 for i in images if i.get("Containers", 0) == 0)},
        "containers": {"count": len(containers), "running": sum(1 for x in containers if x.get("State") == "running"),
                       "size_bytes": sum(x.get("SizeRw", 0) or 0 for x in containers),
                       "reclaimable_bytes": sum(x.get("SizeRw", 0) or 0 for x in containers if x.get("State") != "running")},
        "volumes": {"count": len(vols), "size_bytes": sum(max(0, (v.get("UsageData") or {}).get("Size", 0)) for v in vols),
                    "reclaimable_bytes": sum(max(0, (v.get("UsageData") or {}).get("Size", 0)) for v in vols if (v.get("UsageData") or {}).get("RefCount", 1) == 0),
                    "unused": sum(1 for v in vols if (v.get("UsageData") or {}).get("RefCount", 1) == 0)},
        "build_cache": {"count": len(cache), "size_bytes": sum(b.get("Size", 0) for b in cache),
                        "reclaimable_bytes": sum(b.get("Size", 0) for b in cache if not b.get("InUse") and not b.get("Shared"))},
    }
    with _lock:
        _docker.update(data=data, at=time.time())


# ------------------------------------------------------------------ status
def status():
    arrays = md_arrays()
    ds = disks(arrays)
    smart_any = any((d.get("smart") or {}).get("available") for d in ds)
    with _lock:
        docker = dict(_docker) if _docker["data"] else None
    return {
        "host": host_label(),
        "collected_at": time.time(),
        "mode": "hardware" if arrays or smart_any else "virtual",
        "arrays": arrays,
        "volumes": volumes(arrays),
        "disks": ds,
        "memory": memory(),
        "docker": docker and {"at": docker["at"], **docker["data"]},
        "capabilities": {"smart": SMART_MODE != "off", "docker": os.path.exists(DOCKER_SOCK)},
    }


def background():
    last_docker = 0
    while True:
        try:
            refresh_smart()
            if time.time() - last_docker >= DOCKER_TTL:
                refresh_docker()
                last_docker = time.time()
        except Exception as e:  # noqa: BLE001 - keep collecting
            print("[agent] background error:", e)
        time.sleep(min(SMART_TTL, DOCKER_TTL))


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/cleanup/preview", "/cleanup/apply"):
            return self._send(404, {"error": "not found"})
        if not cleanup.authorized(self.headers.get("x-agent-token")):
            return self._send(403, {"error": "forbidden"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if size < 0 or size > 65536:
                return self._send(413, {"error": "body too large"})
            body = json.loads(self.rfile.read(size) or b"{}")
            result = cleanup.preview() if self.path.endswith("preview") else cleanup.apply(body)
            return self._send(200, result)
        except (ValueError, KeyError, TypeError):
            return self._send(400, {"error": "Invalid or expired cleanup request"})
        except Exception:
            return self._send(502, {"error": "Docker cleanup unavailable"})

    def do_GET(self):
        if self.path == "/health":
            return self._send(200, {"ok": True})
        if self.path == "/insights":
            return self._send(200, insights.snapshot())
        if self.path == "/status":
            try:
                return self._send(200, status())
            except Exception as e:  # noqa: BLE001
                return self._send(500, {"error": str(e)})
        self._send(404, {"error": "not found"})

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


if __name__ == "__main__":
    insights.start()
    refresh_smart()
    refresh_docker()
    threading.Thread(target=background, daemon=True).start()
    print(f"dokploy-plus agent on :{PORT} (smart={SMART_MODE}, docker={os.path.exists(DOCKER_SOCK)}, volumes={VOLUMES})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
