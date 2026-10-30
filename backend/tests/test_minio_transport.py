"""Real local HTTP responses distinguish transfer and health timeout budgets."""
import io
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError

from modelforge.infrastructure.minio import create_store
from modelforge.settings import Settings


def test_transfer_accepts_valid_response_slower_than_two_seconds():
    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'
        def do_GET(self):
            body = b'<LocationConstraint xmlns="http://s3.amazonaws.com/doc/2006-03-01/">us-east-1</LocationConstraint>'
            self.send_response(200)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def do_PUT(self):
            self.rfile.read(int(self.headers['Content-Length']))
            time.sleep(2.3)
            self.send_response(200)
            self.send_header('ETag', '"900150983cd24fb0d6963f7d28e17f72"')
            self.send_header('Content-Length', '0')
            self.end_headers()
        def log_message(self, *_):
            pass
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings = Settings(pg_password='test-only', minio_access_key='test-only',
                        minio_secret_key='test-only-secret',
                        minio_endpoint=f'127.0.0.1:{server.server_port}')
    store = create_store(settings)
    try:
        try:
            result = store.put_object('transport-test', 'object', io.BytesIO(b'abc'), 3)
            outcome = result.object_name
        except Exception as error:
            outcome = type(error).__name__
        assert outcome == 'object'
    finally:
        store._http.clear()
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_authenticated_health_keeps_short_probe_budget(monkeypatch):
    from modelforge.entrypoints.api import app
    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            body = b'<LocationConstraint>us-east-1</LocationConstraint>'
            self.send_response(200)
            self.end_headers()
            self.wfile.write(body)
        def do_HEAD(self):
            time.sleep(0.3)
            self.send_response(200)
            self.end_headers()
        def log_message(self, *_):
            pass
    class Pool:
        @contextmanager
        def connection(self):
            yield SimpleNamespace(execute=lambda _: SimpleNamespace(fetchone=lambda: {'connected': 1}))
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    settings = Settings(pg_password='test-only', minio_access_key='test-only',
                        minio_secret_key='test-only-secret', probe_timeout=0.05,
                        minio_endpoint=f'127.0.0.1:{server.server_port}', minio_read_timeout=3)
    store = create_store(settings)
    monkeypatch.setattr(app.state, 'resources', SimpleNamespace(settings=settings, store=store, pool=Pool()), raising=False)
    try:
        response = TestClient(app).get('/api/v1/health/ready')
        assert response.status_code == 503
        assert response.json()['components']['minio']['state'] == 'down'
    finally:
        store._http.clear()
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


@pytest.mark.parametrize('value', [0, -1, 601, float('inf'), float('nan')])
def test_rejects_unbounded_storage_timeout(value):
    with pytest.raises(ValidationError):
        Settings(pg_password='test-only', minio_access_key='test-only',
                 minio_secret_key='test-only-secret', minio_read_timeout=value)
