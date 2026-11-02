"""Real Linux processes, no GPU, no cloud writes."""
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid
import pytest

pytestmark=pytest.mark.skipif(sys.platform!='linux',reason='Linux process identity required')
AGENT=Path(__file__).parents[1]/'src/modelforge/infrastructure/remote_agent.py'

@pytest.fixture
def rpc(tmp_path):
    root=tmp_path/'remote'; job=str(uuid.uuid4())
    def call(operation, payload=b'', **kwargs):
        request={'root':str(root),'job_id':job,'operation':operation,**kwargs}
        run=subprocess.run([sys.executable,str(AGENT)],input=json.dumps(request).encode()+b'\n'+payload,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
        assert run.returncode==0,run.stderr.decode()
        return json.loads(run.stdout)
    yield call,root/job
    try: call('cancel')
    except Exception: pass

def poll(call, expected):
    deadline=time.monotonic()+12
    while time.monotonic()<deadline:
        response=call('status'); state=response['result']['state']
        if state==expected:return response['result']
        time.sleep(.05)
    raise AssertionError(response)

def test_launch_once_and_durable_reconnect(rpc):
    call,directory=rpc
    argv=[sys.executable,'-c',"import pathlib,time; p=pathlib.Path('count'); p.write_text(p.read_text()+'x' if p.exists() else 'x'); time.sleep(.3); print('completed')"]
    assert call('start',argv=argv)['ok']
    for i in range(4):assert call('start',argv=argv)['ok']
    receipt=poll(call,'exited')
    assert receipt['exit_code']==0 and receipt['group_exited']
    assert (directory/'count').read_text()=='x'
    assert b'completed' in base64.b64decode(call('read',path='process.log')['result']['data'])
    assert call('start',argv=[sys.executable,'-c','pass'])['ok'] is False

def test_cancel_kills_real_child_and_descendant_group(rpc):
    call,directory=rpc
    script="import subprocess,sys,time; subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)']);print('started',flush=True);time.sleep(60)"
    call('start',argv=[sys.executable,'-c',script]); poll(call,'running')
    call('cancel'); receipt=poll(call,'exited')
    assert receipt['cancelled'] and receipt['group_exited']

def test_transfer_integrity_and_sealing(rpc):
    call,_=rpc; data=b'fixed input'
    assert not call('put',payload=data,path='input.json',size=len(data),sha256='0'*64)['ok']
    digest=hashlib.sha256(data).hexdigest()
    assert call('put',payload=data,path='input.json',size=len(data),sha256=digest)['ok']
    assert not call('start',argv=[sys.executable,'-c','pass'],inputs=[{'path':'input.json','size':len(data),'sha256':'0'*64}])['ok']
    assert call('start',argv=[sys.executable,'-c','pass'],inputs=[{'path':'input.json','size':len(data),'sha256':digest}])['ok']
    poll(call,'exited')
    assert not call('put',payload=data,path='late.json',size=len(data),sha256=digest)['ok']

def test_ambiguous_launch_never_restarts(rpc):
    call,directory=rpc
    directory.mkdir(parents=True,mode=0o700)
    argv=[sys.executable,'-c','pass']
    digest=hashlib.sha256(json.dumps(argv,separators=(',',':')).encode()).hexdigest()
    (directory/'receipt.json').write_text(json.dumps({'state':'launching','command_sha256':digest}))
    assert call('status')['result']['state']=='unknown'
    assert call('start',argv=argv)['result']['state']=='unknown'
    assert not (directory/'process.log').exists()

def test_traversal_and_symlink_rejected(rpc):
    call,directory=rpc
    assert not call('read',path='../outside')['ok']
    (directory/'escape').symlink_to('/tmp')
    assert not call('read',path='escape/something')['ok']

def test_queued_cancellation_prevents_launch(rpc):
    call,_=rpc; call('cancel')
    result=call('start',argv=[sys.executable,'-c',"raise RuntimeError('must not execute')"])['result']
    assert result['state']=='exited' and result['cancelled'] and result['group_exited']

def test_runtime_preflight_reports_version_drift_without_starting_work(rpc):
    call,directory=rpc
    lock={'schema':1,'id':'fixture-lock','python':'0.0.0','cuda':'0.0',
          'packages':{'modelforge-runtime-package-that-does-not-exist':'1.0.0'}}
    report=call('runtime_check',lock=lock)['result']
    assert report['ready'] is False
    assert report['lock_id']=='fixture-lock'
    assert any(item['field']=='python' for item in report['mismatches'])
    assert any(item['field']=='modelforge-runtime-package-that-does-not-exist'
               for item in report['mismatches'])
    assert not directory.exists()
    assert call('status')['result']['state']=='not_started'
