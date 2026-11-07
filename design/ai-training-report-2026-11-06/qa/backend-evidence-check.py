"""Read-only evidence check against the local ModelForge database."""
from __future__ import annotations

import json
import uuid

from modelforge.bootstrap import Resources
from modelforge.modules.diagnosis.evidence import EvidenceCollector
from modelforge.modules.diagnosis.gates import GateEngine
from modelforge.settings import get_settings


ATTEMPTS = {
    'success': 'fbc8a03d-27e3-4ef2-8253-c23ac8a599ac',
    'failed': 'f3801f77-48e1-4b30-b6f3-5448f4a7bb4f',
    'cancelled': '4caec70d-eb19-445f-8b08-97fdec64276d',
}


def main() -> None:
    resources = Resources.open(get_settings())
    try:
        collector = EvidenceCollector(resources)
        gate_engine = GateEngine()
        output = {}
        for label, identifier in ATTEMPTS.items():
            pack = collector.collect(uuid.UUID(identifier))
            gate = gate_engine.evaluate(pack)
            facts = pack.facts
            metrics = facts.get('metrics') or {}
            adapters = facts.get('adapters') or {}
            coverage = {item.category: item.status for item in pack.coverage}
            output[label] = {
                'attempt_id': identifier,
                'attempt_state': pack.attempt_state,
                'health': gate.health_status,
                'delivery': gate.delivery_status,
                'health_reasons': [item.code for item in gate.health_reasons],
                'delivery_reasons': [item.code for item in gate.delivery_reasons],
                'metrics': metrics.get('counts'),
                'latest_eval': metrics.get('latest_eval'),
                'adapter_states': {
                    role: (adapters.get(role) or {}).get('state')
                    for role in ('best', 'final')
                },
                'inference_trials': len(facts.get('inference_trials') or []),
                'inference_acceptance': len(
                    facts.get('inference_acceptance') or []
                ),
                'coverage': coverage,
                'evidence_count': len(pack.evidence),
                'canonical_digest': pack.canonical_digest,
                'source_inference_revision': (
                    pack.source_revision.inference_revision
                ),
            }
        print(json.dumps(output, ensure_ascii=False, indent=2))
    finally:
        resources.close()


if __name__ == '__main__':
    main()
