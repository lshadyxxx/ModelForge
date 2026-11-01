"""Read-only composition through module public contracts."""
from fastapi import APIRouter,Request
from modelforge.modules.datasets import DatasetRegistry
from modelforge.modules.models import ModelRegistry,Adapters
from modelforge.modules.training import Training
from modelforge.modules.serving import Serving
from modelforge.modules.resources import GpuLeases

router=APIRouter(prefix='/api/v1/overview',tags=['overview'])

@router.get('')
def overview(request:Request):
    r=request.app.state.resources
    datasets=DatasetRegistry(r).list();models=ModelRegistry(r).list()
    return {'datasets_published':sum(row['state']=='published' for row in datasets),
            'models_available':sum(row['state']=='available' for row in models),
            'adapters_available':Adapters(r).available_count(),
            'recent_attempts':Training(r).list()[:5], 'recent_trials':Serving(r).list()[:5],
            'gpu':GpuLeases(r.pool).current()}
