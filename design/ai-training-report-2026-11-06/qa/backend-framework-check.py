"""Dependency smoke test: PostgresSaver checkpoint and ChatOpenAI wiring."""
from __future__ import annotations

import uuid
from types import SimpleNamespace

from pydantic import SecretStr

from modelforge.bootstrap import Resources
from modelforge.modules.diagnosis.checkpoint import checkpoint_saver
from modelforge.modules.diagnosis.generator import LangChainOpenAIGenerator
from modelforge.settings import get_settings


def main() -> None:
    settings = get_settings()
    resources = Resources.open(settings)
    thread_id = f'diagnosis-smoke:{uuid.uuid4()}'
    try:
        from langgraph.graph import END, START, StateGraph

        builder = StateGraph(dict)
        builder.add_node('echo', lambda state: {'echo': state['value']})
        builder.add_edge(START, 'echo')
        builder.add_edge('echo', END)
        with checkpoint_saver(settings) as saver:
            graph = builder.compile(checkpointer=saver)
            result = graph.invoke(
                {'value': 'checkpoint-ok'},
                config={'configurable': {'thread_id': thread_id}},
            )
            state = graph.get_state({
                'configurable': {'thread_id': thread_id},
            })
        generator = LangChainOpenAIGenerator(SimpleNamespace(
            ai_model='modelforge-framework-smoke',
            ai_base_url='http://127.0.0.1:1/v1',
            ai_api_key=SecretStr('fixture-only'),
            ai_timeout_seconds=5,
            ai_structured_output_method='json_schema',
        ))
        print({
            'checkpoint_thread': thread_id,
            'checkpoint_result': result,
            'checkpoint_values': state.values,
            'checkpoint_has_next': bool(state.next),
            'chat_openai_class': type(generator.model).__name__,
            'generator_class': type(generator).__name__,
            'structured_output': type(generator.structured).__name__,
        })
    finally:
        with resources.pool.connection() as connection:
            for table in (
                'checkpoint_writes',
                'checkpoint_blobs',
                'checkpoints',
            ):
                connection.execute(
                    f'DELETE FROM langgraph_checkpoint.{table} '
                    'WHERE thread_id = %s',
                    (thread_id,),
                )
        resources.close()


if __name__ == '__main__':
    main()
