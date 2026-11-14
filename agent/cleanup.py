"""Explicit cleanup of old, untagged images only. Never deletes containers or volumes."""
import base64
import hashlib
import hmac
import json
import time
from pathlib import Path
from urllib.parse import quote
import insights

KEY_FILE = Path('/run/secrets/agent-token')

def authorized(value):
    try:
        key = KEY_FILE.read_text().strip()
        return bool(key) and hmac.compare_digest(value or '', key)
    except OSError:
        return False

def candidates():
    now = time.time()
    return [{'id': i['Id'], 'size_bytes': i.get('Size', 0), 'created': i.get('Created')}
            for i in insights.docker('/system/df').get('Images') or []
            if i.get('Containers') == 0 and not [t for t in i.get('RepoTags') or [] if t != '<none>:<none>']
            and i.get('Created', now) < now-7*86400]

def preview():
    images = candidates()
    payload = base64.urlsafe_b64encode(json.dumps({'ids': [i['id'] for i in images], 'exp': time.time()+300}).encode()).decode()
    signature = hmac.new(KEY_FILE.read_bytes().strip(), payload.encode(), hashlib.sha256).hexdigest()
    return {'images': images, 'ticket': payload+'.'+signature, 'expiresIn': 300}

def apply(body):
    payload, signature = body.get('ticket', '').split('.', 1)
    expected = hmac.new(KEY_FILE.read_bytes().strip(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise ValueError('Invalid cleanup preview')
    plan = json.loads(base64.urlsafe_b64decode(payload))
    selected = body.get('ids')
    if body.get('confirmation') != 'DELETE' or time.time() > plan['exp'] or not isinstance(selected, list) or not selected:
        raise ValueError('Expired preview or confirmation missing')
    if len(selected) > 100 or any(i not in plan['ids'] for i in selected):
        raise ValueError('Image not included in preview')
    eligible = {i['id'] for i in candidates()}
    result = []
    for image in dict.fromkeys(selected):
        if image not in eligible:
            result.append({'id': image, 'deleted': False, 'error': 'Image no longer eligible'})
            continue
        try:
            insights.docker('/images/'+quote(image, safe='')+'?force=false&noprune=true', method='DELETE')
            result.append({'id': image, 'deleted': True})
        except Exception:
            result.append({'id': image, 'deleted': False, 'error': 'Docker refused deletion'})
    return {'results': result}
