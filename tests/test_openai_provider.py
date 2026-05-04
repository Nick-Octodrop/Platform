import io
import json
import os
import urllib.error
from unittest.mock import patch

os.environ.setdefault("USE_DB", "0")
os.environ.setdefault("OCTO_DISABLE_AUTH", "1")
os.environ.setdefault("SUPABASE_URL", "http://localhost")

import app.main as main


class _FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def _http_error(status_code: int, message: str) -> urllib.error.HTTPError:
    body = json.dumps({"error": {"message": message}}).encode("utf-8")
    return urllib.error.HTTPError(
        "https://api.openai.com/v1/chat/completions",
        status_code,
        "Bad Request",
        hdrs=None,
        fp=io.BytesIO(body),
    )


def test_openai_provider_uses_env_api_key_fallback():
    with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}, clear=False), patch.object(main, "_active_secret_ref_for_provider", lambda *_args, **_kwargs: None):
        assert main._openai_configured() is True
        assert main._resolve_provider_secret_value("openai") == "sk-test"


def test_openai_chat_completion_retries_without_temperature_when_model_rejects_it():
    calls = []

    def fake_urlopen(request, timeout=None):
        calls.append(json.loads(request.data.decode("utf-8")))
        if len(calls) == 1:
            raise _http_error(400, "Unsupported value: temperature does not support 0.05 with this model. Only the default is supported.")
        return _FakeResponse({"choices": [{"message": {"content": "{\"ok\": true}"}}]})

    with patch.object(main, "_resolve_provider_secret_value", lambda *_args, **_kwargs: "sk-test"), patch.object(main.urllib.request, "urlopen", fake_urlopen):
        result = main._openai_chat_completion(
            [{"role": "user", "content": "Return JSON."}],
            model="gpt-5.1",
            temperature=0.05,
            response_format={"type": "json_object"},
        )

    assert result["choices"][0]["message"]["content"] == "{\"ok\": true}"
    assert "temperature" in calls[0]
    assert "temperature" not in calls[1]


def test_openai_chat_completion_includes_http_error_detail():
    def fake_urlopen(_request, timeout=None):
        raise _http_error(400, "Context length exceeded.")

    with patch.object(main, "_resolve_provider_secret_value", lambda *_args, **_kwargs: "sk-test"), patch.object(main.urllib.request, "urlopen", fake_urlopen):
        try:
            main._openai_chat_completion([{"role": "user", "content": "Hello"}])
        except RuntimeError as exc:
            assert "OpenAI request failed (400): Context length exceeded." in str(exc)
        else:
            raise AssertionError("Expected RuntimeError")
