"""Explicit machine context for the tracked Gateway v5 custody helpers.

This changes where code is executed, not any frozen evidence or accepted digest.
"""
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import stat
from typing import Optional


class ContextError(ValueError):
    pass


def require(value, reason):
    if not value:
        raise ContextError(reason)


def exact(value, keys):
    require(type(value) is dict and set(value) == set(keys), 'context object has unexpected fields')


def path(value):
    require(type(value) is str and 0 < len(value) <= 4096 and '\0' not in value, 'context path is invalid')
    p = Path(value)
    require(p.is_absolute() and str(p) == value and os.path.normpath(value) == value, 'context requires canonical absolute paths')
    return p


@dataclass(frozen=True)
class GatewayContext:
    work: Path
    repository: Path
    python: Path
    bun: Path
    vercel: Path
    ps: Path
    project: str
    scope: str
    document_path: Optional[Path] = None
    document_sha256: Optional[str] = None

    @property
    def runtime(self):
        return self.work / 'gateway-study-v5-candidate'

    @property
    def study(self):
        return self.work / 'gateway-study-v5'

    @property
    def locks(self):
        names = ['claude-subscription-study-v1', 'claude-subscription-study-v2', 'gateway-study-v3', 'gateway-study-v4', 'gateway-study-v5']
        return [self.work / name / 'active.lock' for name in names] + [self.repository / '.cache/benchmarks/openai-pilot.lock']


def parse_context(value):
    exact(value, ['schema', 'workDirectory', 'repositoryDirectory', 'tools', 'auth'])
    require(value['schema'] == 'oh.gateway-audit-context.v1', 'unsupported context schema')
    tools, auth = value['tools'], value['auth']
    exact(tools, ['python', 'bun', 'vercel', 'ps'])
    exact(auth, ['method', 'project', 'scope', 'environment'])
    require(auth['method'] == 'project-oidc' and auth['environment'] == 'development', 'unsupported context authority')
    for key in ['project', 'scope']:
        require(type(auth[key]) is str and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,99}', auth[key]), 'context authority slug is invalid')
    tool_paths = {name: path(value) for name, value in tools.items()}
    require(tool_paths['ps'] == Path('/bin/ps'), 'custody executable must remain /bin/ps')
    for name in ['bun', 'vercel', 'ps']:
        require(tool_paths[name].name == name, 'context tool basename is invalid')
    require(re.fullmatch(r'python(?:3(?:\.\d+)?)?', tool_paths['python'].name), 'context Python basename is invalid')
    work, repository = path(value['workDirectory']), path(value['repositoryDirectory'])
    require(work != repository, 'context artifact and repository directories must differ')
    return GatewayContext(work, repository, tool_paths['python'], tool_paths['bun'], tool_paths['vercel'], tool_paths['ps'], auth['project'], auth['scope'])


def _read(path_value, maximum=65536):
    p = path(str(path_value))
    require(p.parent.resolve() == p.parent, 'context parent path is an alias')
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        initial = os.fstat(fd)
        require(stat.S_ISREG(initial.st_mode) and initial.st_uid == os.getuid() and initial.st_nlink == 1 and initial.st_size <= maximum, 'context file custody is invalid')
        chunks, size = [], 0
        while True:
            chunk = os.read(fd, maximum + 1 - size)
            if not chunk:
                break
            chunks.append(chunk); size += len(chunk)
            require(size <= maximum, 'context file exceeds its bound')
        signature = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mode, s.st_uid, s.st_nlink, s.st_mtime_ns, s.st_ctime_ns)
        require(signature(initial) == signature(os.fstat(fd)) == signature(p.lstat()) and size == initial.st_size, 'context file changed during read')
        return b''.join(chunks)
    finally:
        os.close(fd)


def _decode(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'context or evidence has duplicate JSON fields'); result[key] = value
        return result
    def nonfinite(_):
        raise ContextError('context or evidence has nonfinite JSON')
    return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=nonfinite)


def load_context(path_value):
    p = path(str(path_value)); raw = _read(p)
    context = parse_context(_decode(raw))
    return GatewayContext(**{**context.__dict__, 'document_path': p, 'document_sha256': hashlib.sha256(raw).hexdigest()})


def verify_context(context):
    require(context.document_path is not None and context.document_sha256 is not None, 'context must be loaded from an explicit file')
    raw = _read(context.document_path)
    require(hashlib.sha256(raw).hexdigest() == context.document_sha256, 'context file changed after admission')
    parsed = parse_context(_decode(raw))
    require(all(getattr(context, key) == value for key, value in parsed.__dict__.items() if not key.startswith('document_')), 'context fields differ from their admitted document')


# Existing-study anchors. These are not configurable authority or relocation overrides.
STUDY_FREEZE_SHA256 = '92fed47664b2907d4f47c3a7a247aa439222d70c850fc6a1f21e2c2afa87d97a'
STUDY_AUTHORITY_SHA256 = 'ec9c8b9c57f85bdc8fb7769354886184e902d55ed37d59fed10ef4e349a87b5c'
FIRST_CONFIGURATION_SHA256 = '74218a48d280ee98729575ae264309aebb491fafbe2ef594c03e017e7bc9f389'


def _pinned(value, maximum):
    exact(value, ['path', 'sha256'])
    require(type(value['sha256']) is str and re.fullmatch(r'[a-f0-9]{64}', value['sha256']), 'evidence pin digest is invalid')
    raw = _read(path(value['path']), maximum)
    require(hashlib.sha256(raw).hexdigest() == value['sha256'], 'study binding evidence changed')
    return _decode(raw)


def validate_study_binding(context, freeze_pin):
    """Authenticate context against immutable existing authority and first producer argv."""
    verify_context(context)
    require(freeze_pin == {'path': str(context.study / 'freeze.json'), 'sha256': STUDY_FREEZE_SHA256}, 'context does not match the fixed study freeze')
    freeze = _pinned(freeze_pin, 8 * 1024 * 1024)
    require(type(freeze) is dict and freeze.get('protocol') == 'oh.memory-gateway-freeze.v5', 'fixed study freeze schema changed')
    authority_pin = freeze.get('authority'); exact(authority_pin, ['path', 'sha256'])
    require(authority_pin['sha256'] == STUDY_AUTHORITY_SHA256, 'fixed authority pin changed')
    authority = _pinned(authority_pin, 1024 * 1024)
    require(type(authority) is dict and authority.get('schema') == 'oh.gateway-v3-authority.v1', 'fixed authority schema changed')
    expected_auth = {'method': 'project-oidc', 'project': context.project, 'scope': context.scope, 'environment': 'development'}
    actual_auth = {'method': 'project-oidc', 'project': authority.get('project'), 'scope': authority.get('scope'), 'environment': authority.get('environment')}
    require(actual_auth == expected_auth, 'context differs from the pinned study authority')
    require(type(freeze.get('procedure')) is dict and freeze['procedure'].get('auth') == expected_auth, 'context differs from the frozen procedure authority')
    first_job = context.work / 'gateway-study-v5-batch-001'
    configuration = _pinned({'path': str(first_job / 'config.json'), 'sha256': FIRST_CONFIGURATION_SHA256}, 128 * 1024)
    exact(configuration, ['argv', 'cwd', 'jobDir', 'requireAbsent'])
    expected_argv = [str(context.vercel), 'env', 'run', '--project', context.project, '--scope', context.scope, '--environment', 'development', '--', str(context.bun),
                     str(context.runtime / 'scripts/benchmarks/gateway-study-v5.ts'), 'run', '--directory', str(context.study), '--freeze-sha256', STUDY_FREEZE_SHA256, '--max-new-calls', '32']
    require(configuration['argv'] == expected_argv and configuration['cwd'] == str(context.runtime) and configuration['jobDir'] == str(first_job), 'context differs from the pinned first producer command')
    absent = configuration['requireAbsent']
    require(type(absent) is list and len(absent) == len(set(absent)) and set(absent) == set(map(str, context.locks)), 'context differs from the pinned first lock set')
    return {'freeze': freeze_pin, 'authority': authority_pin, 'firstConfiguration': {'path': str(first_job / 'config.json'), 'sha256': FIRST_CONFIGURATION_SHA256}}
