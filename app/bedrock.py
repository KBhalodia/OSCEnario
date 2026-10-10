"""
The ONE place that talks to Claude on Bedrock. Everything else calls
`llm.call_json(...)` or `llm.call_text(...)`, so tests can swap in a fake.

Set these env vars (copy IDs from Bedrock console -> Model catalog / Cross-region
inference; use the inference-profile ID, e.g. one starting with "us.anthropic."):
    AWS_REGION=us-east-1
    VPE_FAST_MODEL=<haiku-class model id>    # router + patient, every turn
    VPE_SMART_MODEL=<sonnet-class model id>  # generator, linking, feedback
"""
from __future__ import annotations

import json
import os
import time
from typing import Any, Optional, Protocol


class LLM(Protocol):
    def call_json(self, *, model: str, system: str, schema: dict, tool_name: str,
                  messages: list[dict] | None = None, user: str | None = None,
                  max_tokens: int = 1024, temperature: float = 0.0) -> dict: ...

    def call_text(self, *, model: str, system: str, messages: list[dict],
                  max_tokens: int = 1024, temperature: float = 0.7) -> str: ...


def fast_model() -> str:
    return _env("VPE_FAST_MODEL")


def smart_model() -> str:
    return _env("VPE_SMART_MODEL")


def _env(name: str) -> str:
    v = os.environ.get(name)
    if not v:
        raise RuntimeError(f"Set {name} to a Bedrock model / inference-profile ID (see bedrock.py).")
    return v


def user_msg(text: str) -> dict:
    return {"role": "user", "content": [{"text": text}]}


def assistant_msg(text: str) -> dict:
    return {"role": "assistant", "content": [{"text": text}]}


class BedrockLLM:
    def __init__(self, region: Optional[str] = None):
        import boto3
        from botocore.config import Config
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=region or os.environ.get("AWS_REGION", "us-east-1"),
            config=Config(retries={"max_attempts": 5, "mode": "adaptive"}, read_timeout=120),
        )
        self._no_temperature: set[str] = set()

    def _converse(self, model: str, temperature: float, max_tokens: int, **kwargs) -> dict:
        """converse() that copes with newer models rejecting `temperature`:
        on that error, retry without it and remember the model for next time."""
        cfg: dict[str, Any] = {"maxTokens": max_tokens}
        if model not in self._no_temperature:
            cfg["temperature"] = temperature
        try:
            return self.client.converse(modelId=model, inferenceConfig=cfg, **kwargs)
        except self.client.exceptions.ValidationException as e:
            if "temperature" not in str(e) or "temperature" not in cfg:
                raise
            self._no_temperature.add(model)
            cfg.pop("temperature")
            return self.client.converse(modelId=model, inferenceConfig=cfg, **kwargs)

    def call_json(self, *, model, system, schema, tool_name, messages=None, user=None,
                  max_tokens=1024, temperature=0.0) -> dict:
        """Force Claude to answer by 'calling' a tool whose input schema is `schema`.
        The tool input IS our structured result."""
        msgs = list(messages or []) + ([user_msg(user)] if user else [])
        last_err: Exception | None = None
        for attempt in range(2):  # one retry if the model skips the tool
            resp = self._converse(
                model, temperature, max_tokens,
                system=[{"text": system}],
                messages=msgs,
                toolConfig={
                    "tools": [{"toolSpec": {
                        "name": tool_name,
                        "description": f"Return the {tool_name} result.",
                        "inputSchema": {"json": schema},
                    }}],
                    "toolChoice": {"tool": {"name": tool_name}},
                },
            )
            for block in resp["output"]["message"]["content"]:
                if "toolUse" in block:
                    out = block["toolUse"]["input"]
                    return json.loads(out) if isinstance(out, str) else out
            last_err = ValueError(f"No tool call in response: {resp['output']}")
            time.sleep(0.5)
        raise last_err  # type: ignore[misc]

    def call_text(self, *, model, system, messages, max_tokens=1024, temperature=0.7) -> str:
        resp = self._converse(model, temperature, max_tokens,
                              system=[{"text": system}], messages=messages)
        return "".join(b.get("text", "") for b in resp["output"]["message"]["content"])


_default: Optional[BedrockLLM] = None


def get_llm() -> BedrockLLM:
    """Shared client for the FastAPI app (boto3 clients are thread-safe)."""
    global _default
    if _default is None:
        _default = BedrockLLM()
    return _default