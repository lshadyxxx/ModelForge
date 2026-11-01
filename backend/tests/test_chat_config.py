import pytest
from pydantic import ValidationError
from modelforge.modules.serving import Chat

def test_top_p_default_and_valid_boundaries():
    values={'messages':[{'role':'user','content':'你好'}]}
    assert Chat(**values).top_p==.9
    assert Chat(**values,top_p=.01).model_dump()['top_p']==.01
    assert Chat(**values,top_p=1).top_p==1

@pytest.mark.parametrize('value',[0,-.01,1.01,float('nan'),float('inf')])
def test_top_p_rejects_outside_supported_range(value):
    with pytest.raises(ValidationError):Chat(messages=[{'role':'user','content':'hi'}],top_p=value)
