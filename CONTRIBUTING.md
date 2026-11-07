# Contributing to ModelForge

Thank you for contributing. ModelForge is an experimental reference platform;
small, evidence-backed changes are preferred over large speculative rewrites.

## Before opening a pull request

1. Search existing issues and design documents.
2. Keep changes scoped to one behavior or documentation concern.
3. Do not commit `.env`, credentials, private keys, cloud resource identifiers,
   personal absolute paths, model weights, datasets or generated runtime data.
4. Add or update tests for behavior changes.
5. State what was actually verified, what was not run, and any remaining risk.

## Local checks

```powershell
cd frontend
npm ci
npm test
npm run build

cd ../backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -e ".[test]"
./.venv/Scripts/python.exe -m pytest -q
./.venv/Scripts/python.exe -m pip check
```

For integration checks, use the existing local Compose services. Do not create
paid cloud resources without explicit authorization.

## AI-generated contributions

AI-assisted work is welcome when the contributor understands and verifies the
change. Do not submit generated claims, metrics or screenshots that were not
actually produced. The AI diagnosis layer must continue to distinguish observed
facts, inferences and recommendations.

## Documentation

Use Chinese or English consistently within a document. Prefer concrete file
paths, commands, contracts and evidence boundaries over broad claims such as
"fully production ready".

## License

By contributing, you agree that your contribution is licensed under the Apache
License 2.0.
