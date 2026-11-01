from fastapi import APIRouter, Request, Query
from pydantic import BaseModel, ConfigDict, Field
import uuid
from modelforge.bootstrap import remote_services
from .use_cases import Training, CreateTask
router = APIRouter(prefix='/api/v1/training',tags=['training'])

class ManualBinding(BaseModel):
    model_config = ConfigDict(extra='forbid')
    instance_id: str = Field(min_length=1,max_length=120,pattern=r'^[A-Za-z0-9_-]+$')
    acknowledge_cleanup: bool

def lifecycle(resources):
    return remote_services(resources).lifecycle

@router.post('/tasks',status_code=201)
def create(body:CreateTask,request:Request): return Training(request.app.state.resources).create(body)

@router.get('/attempts')
def listing(request:Request): return Training(request.app.state.resources).list()

@router.get('/attempts/{identifier}')
def detail(identifier:uuid.UUID,request:Request): return Training(request.app.state.resources).get(identifier)

@router.post('/attempts/{identifier}/cancel')
def cancel(identifier:uuid.UUID,request:Request): return Training(request.app.state.resources).cancel(identifier)

@router.post('/attempts/{identifier}/retry',status_code=201)
def retry(identifier:uuid.UUID,request:Request): return Training(request.app.state.resources).retry(identifier)

@router.post('/attempts/{identifier}/instance')
def bind(identifier:uuid.UUID,body:ManualBinding,request:Request):
    resources=request.app.state.resources
    return Training(resources).bind(identifier,body.instance_id,body.acknowledge_cleanup,lifecycle(resources))

@router.get('/attempts/{identifier}/logs')
def logs(identifier:uuid.UUID,request:Request,offset:int=Query(0,ge=0)):
    return Training(request.app.state.resources).logs(identifier,offset)
