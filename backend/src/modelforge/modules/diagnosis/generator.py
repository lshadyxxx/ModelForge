"""LangChain OpenAI structured generator for advisory candidates."""
from __future__ import annotations

import json
import time
from typing import Protocol

from modelforge.errors import AppError

from .contracts import CandidateReport, ValidationIssue
from .prompts import REPAIR_PROMPT, SYSTEM_PROMPT


GENERATOR_VERSION = 'langchain-openai-structured-v1'


def _integer(value):
    return value if type(value) is int and value >= 0 else None


def _extract_usage(response) -> dict[str, int] | None:
    usage = None
    for generations in getattr(response, 'generations', []) or []:
        for generation in generations:
            message = getattr(generation, 'message', None)
            metadata = getattr(message, 'usage_metadata', None)
            if isinstance(metadata, dict):
                usage = metadata
                break
        if usage:
            break
    if usage is None:
        llm_output = getattr(response, 'llm_output', None)
        token_usage = (
            llm_output.get('token_usage')
            if isinstance(llm_output, dict)
            else None
        )
        usage = token_usage if isinstance(token_usage, dict) else None
    if not isinstance(usage, dict):
        return None
    prompt = _integer(
        usage.get('prompt_tokens', usage.get('input_tokens'))
    )
    completion = _integer(
        usage.get('completion_tokens', usage.get('output_tokens'))
    )
    total = _integer(usage.get('total_tokens'))
    if total is None and prompt is not None and completion is not None:
        total = prompt + completion
    if prompt is None and completion is None and total is None:
        return None
    return {
        'prompt_tokens': prompt,
        'completion_tokens': completion,
        'total_tokens': total,
    }


class _UsageAccumulator:
    def __init__(self):
        self.reset()

    def reset(self):
        self.starts = {}
        self.model_calls = 0
        self.reported_calls = 0
        self.unreported_calls = 0
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.total_tokens = 0
        self._prompt_reported = False
        self._completion_reported = False
        self._total_reported = False
        self.latency_ms = 0

    def start(self, run_id):
        self.starts[str(run_id)] = time.perf_counter()

    def finish(self, run_id, response=None):
        started = self.starts.pop(str(run_id), None)
        if started is not None:
            self.latency_ms += int(
                (time.perf_counter() - started) * 1000
            )
        self.model_calls += 1
        usage = _extract_usage(response) if response is not None else None
        if usage is None:
            self.unreported_calls += 1
            return
        self.reported_calls += 1
        if usage['prompt_tokens'] is not None:
            self.prompt_tokens += usage['prompt_tokens']
            self._prompt_reported = True
        if usage['completion_tokens'] is not None:
            self.completion_tokens += usage['completion_tokens']
            self._completion_reported = True
        if usage['total_tokens'] is not None:
            self.total_tokens += usage['total_tokens']
            self._total_reported = True

    def snapshot(self):
        if self.model_calls == 0:
            return None
        return {
            'schema': 'diagnosis-model-usage-v1',
            'model_calls': self.model_calls,
            'reported_calls': self.reported_calls,
            'unreported_calls': self.unreported_calls,
            'prompt_tokens': (
                self.prompt_tokens if self._prompt_reported else None
            ),
            'completion_tokens': (
                self.completion_tokens if self._completion_reported else None
            ),
            'total_tokens': (
                self.total_tokens if self._total_reported else None
            ),
            'latency_ms': self.latency_ms,
            'cost_estimate': None,
            'cost_note': 'provider_price_not_configured',
        }


class Generator(Protocol):
    model_name: str

    def generate(self, context: str) -> CandidateReport: ...

    def repair(
        self,
        context: str,
        candidate: CandidateReport,
        issues: list[ValidationIssue],
    ) -> CandidateReport: ...


class LangChainOpenAIGenerator:
    model_name: str
    generator_version = GENERATOR_VERSION

    def __init__(self, settings):
        if not settings.ai_model:
            raise AppError(503, 'ai_model_not_configured', 'AI 报告模型未配置。')
        if settings.ai_api_key is None:
            raise AppError(503, 'ai_credentials_not_configured', 'AI 报告模型凭据未配置。')
        try:
            from langchain_core.callbacks import BaseCallbackHandler
            from langchain_openai import ChatOpenAI
        except ImportError as error:
            raise AppError(503, 'ai_dependency_unavailable', 'AI 报告依赖不可用。') from error

        self._usage = _UsageAccumulator()
        usage = self._usage

        class Callback(BaseCallbackHandler):
            def on_llm_start(self, serialized, prompts, *, run_id, **kwargs):
                usage.start(run_id)

            def on_llm_end(self, response, *, run_id, **kwargs):
                usage.finish(run_id, response)

            def on_llm_error(self, error, *, run_id, **kwargs):
                usage.finish(run_id)

        self.model_name = settings.ai_model
        self.model = ChatOpenAI(
            model=settings.ai_model,
            api_key=settings.ai_api_key,
            base_url=settings.ai_base_url,
            temperature=0,
            timeout=settings.ai_timeout_seconds,
            max_retries=0,
            callbacks=[Callback()],
        )
        self.structured, self.requires_json_instruction = self._structured_model(
            self.model,
            method=settings.ai_structured_output_method,
        )

    @staticmethod
    def _structured_model(model, *, method: str):
        if method == 'json_mode':
            from langchain_core.output_parsers import JsonOutputParser

            return (
                model.bind(response_format={'type': 'json_object'})
                | JsonOutputParser(pydantic_object=CandidateReport),
                True,
            )
        try:
            return (
                model.with_structured_output(
                    CandidateReport,
                    method=method,
                    strict=True,
                ),
                False,
            )
        except TypeError:
            # Some OpenAI-compatible providers do not implement strict schema
            # projection. The request still uses the configured structured
            # mode and the full report remains subject to the Validator.
            return (
                model.with_structured_output(CandidateReport, method=method),
                False,
            )

    def _structured_input(self, human: str) -> str:
        if not self.requires_json_instruction:
            return human
        schema = json.dumps(
            CandidateReport.model_json_schema(),
            ensure_ascii=False,
            separators=(',', ':'),
        )
        return (
            human
            + '\n只返回一个 JSON 对象，不要 Markdown 代码围栏或解释。'
            + '必须严格符合以下 JSON Schema：\n'
            + schema
        )

    def _invoke(self, system: str, human: str) -> CandidateReport:
        from langchain_core.messages import HumanMessage, SystemMessage

        try:
            result = self.structured.invoke([
                SystemMessage(content=system),
                HumanMessage(content=self._structured_input(human)),
            ])
        except Exception as error:
            raise AppError(
                503,
                'ai_generation_failed',
                'AI 报告生成服务暂时不可用，请稍后重试。',
            ) from error
        if not isinstance(result, CandidateReport):
            try:
                result = CandidateReport.model_validate(result)
            except Exception as error:
                raise AppError(
                    503,
                    'ai_output_invalid',
                    'AI 报告未返回结构化结果，已阻止发布。',
                ) from error
        return result

    def generate(self, context: str) -> CandidateReport:
        return self._invoke(
            SYSTEM_PROMPT,
            (
                '请根据以下冻结事实生成 CandidateReport。'
                '不要输出 Markdown 代码围栏，只返回结构化对象。\n'
                + context
            ),
        )

    def reset_usage(self) -> None:
        self._usage.reset()

    def usage(self) -> dict | None:
        return self._usage.snapshot()

    def repair(
        self,
        context: str,
        candidate: CandidateReport,
        issues: list[ValidationIssue],
    ) -> CandidateReport:
        return self._invoke(
            SYSTEM_PROMPT + '\n' + REPAIR_PROMPT,
            (
                '以下是冻结事实、校验问题和上一份候选报告。'
                '返回修复后的完整 CandidateReport。\n'
                + context
                + '\nvalidation_issues='
                + '[' + ','.join(
                    issue.model_dump_json() for issue in issues
                ) + ']'
                + '\nprevious_candidate='
                + candidate.model_dump_json()
            ),
        )
