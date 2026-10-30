"""The opt-in runner must refuse shared stores before opening any connection."""
import os
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize('database,bucket,confirmed,accepted', [
    ('modelforge', 'modelforge', '1', False),
    ('modelforge_test_collect', 'modelforge', '1', False),
    ('modelforge_test_collect', 'modelforge-test-collect', '0', False),
    ('modelforge_test_collect', 'modelforge-test-collect', '1', True),
])
def test_import_suite_requires_explicit_isolated_stores(database, bucket, confirmed, accepted):
    environment = {**os.environ, 'MF_TEST_INTEGRATION': '1',
                   'MF_PG_DATABASE': database, 'MF_MINIO_BUCKET': bucket,
                   'MF_TEST_ISOLATED_STORES': confirmed, 'PYTHONDONTWRITEBYTECODE': '1'}
    result = subprocess.run(
        [sys.executable, '-B', '-m', 'pytest', '--collect-only', '-q', '-p', 'no:cacheprovider',
         str(ROOT / 'backend/tests/test_model_imports.py')],
        cwd=ROOT, env=environment, capture_output=True, text=True, timeout=30,
    )
    output = result.stdout + result.stderr
    if accepted:
        assert result.returncode == 0, output
        assert 'test_failed_import_retries_fixed_snapshot_and_reuses_verified_file' in output
    else:
        assert result.returncode != 0, output
        assert 'Integration tests require explicitly disposable' in output
