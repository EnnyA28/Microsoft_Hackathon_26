"""backend/ai_client.py --- the single place to plug in your Azure AI Foundry model.

EcoTwin works fully offline: if no model is configured the advisor falls back to
a deterministic, rule-based report. When you deploy a model on Azure AI Foundry,
paste its endpoint + key below (or set the env vars) and the advisor will use it
to write the executive summary and strategic narrative grounded in the live spec.

----------------------------------------------------------------------------
HOW TO WIRE IN YOUR MODEL
----------------------------------------------------------------------------
1. Deploy a chat model on Azure AI Foundry.
2. Put your secrets in backend/.env (git-ignored) -- copy backend/.env.example
   to backend/.env and fill it in. Real OS environment variables override the
   file if both are set.
       FOUNDRY_ENDPOINT=<full chat-completions URL>
       FOUNDRY_API_KEY=<your model key>
       FOUNDRY_MODEL=<deployment name>      # optional on the Azure OpenAI URL
3. The endpoint must be the FULL chat-completions URL, e.g.
     Azure OpenAI:
       https://<resource>.openai.azure.com/openai/deployments/<deployment>/chat/completions?api-version=2024-08-01-preview
     Azure AI Foundry (serverless / model inference):
       https://<resource>.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview
   For the serverless URL also set FOUNDRY_MODEL to the deployment name.
4. That's it -- never commit real keys. Restart the backend after editing .env.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


def _load_env_file() -> dict[str, str]:
    """Read KEY=VALUE pairs from a local .env (stdlib only, no dependency).

    Looks next to this file (backend/.env) first, then the repo root (.env).
    Blank lines and '#' comments are ignored; surrounding quotes are stripped.
    Real OS environment variables always take precedence over these.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    candidates = [
        os.path.join(here, ".env"),                   # backend/.env
        os.path.join(os.path.dirname(here), ".env"),  # repo-root/.env
    ]
    values: dict[str, str] = {}
    for path in candidates:
        try:
            with open(path, encoding="utf-8") as fh:
                lines = fh.readlines()
        except OSError:
            continue
        for raw in lines:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            values.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    return values


_ENV_FILE = _load_env_file()


def _cfg(name: str, default: str = "") -> str:
    """OS environment variable first, then backend/.env, then the default."""
    return os.environ.get(name) or _ENV_FILE.get(name, default)


# Configured via backend/.env (git-ignored) or real env vars -- never hardcode keys.
FOUNDRY_ENDPOINT = _cfg("FOUNDRY_ENDPOINT")  # full chat-completions URL
FOUNDRY_API_KEY = _cfg("FOUNDRY_API_KEY")    # your model key
FOUNDRY_MODEL = _cfg("FOUNDRY_MODEL", "gpt-5.4-nano")  # deployment name

REQUEST_TIMEOUT = float(_cfg("FOUNDRY_TIMEOUT", "30"))


def ai_available() -> bool:
    """True when an endpoint + key are configured (so the advisor should call out)."""
    return bool(FOUNDRY_ENDPOINT and FOUNDRY_API_KEY)


def _send(body: dict) -> tuple[dict | None, bool]:
    """POST one request to FOUNDRY_ENDPOINT. Returns ``(payload, retryable)``.

    ``retryable`` is True only for a 400 that rejects an adjustable parameter
    (e.g. the token-limit field or temperature), so the caller can try a
    stripped-down body instead of giving up.
    """
    request = urllib.request.Request(
        FOUNDRY_ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
    )
    request.add_header("Content-Type", "application/json")
    # Azure OpenAI + Azure AI Foundry both accept the "api-key" header; some
    # serverless endpoints expect a bearer token. Sending both is harmless; if
    # your gateway rejects one, delete the line it doesn't like.
    request.add_header("api-key", FOUNDRY_API_KEY)
    request.add_header("Authorization", f"Bearer {FOUNDRY_API_KEY}")

    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8")), False
    except urllib.error.HTTPError as exc:
        try:
            detail = exc.read().decode("utf-8")
        except Exception:  # noqa: BLE001
            detail = ""
        return None, exc.code == 400 and "unsupported_parameter" in detail
    except (urllib.error.URLError, ValueError, TimeoutError):
        return None, False


def _extract_chat_text(payload: dict) -> str | None:
    """Pull the assistant text out of a chat-completions response."""
    try:
        return payload["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        return None


def _extract_responses_text(payload: dict) -> str | None:
    """Pull the assistant text out of a Responses API payload.

    Prefers the aggregated ``output_text`` convenience field, else walks the
    ``output`` items and concatenates the text parts of the message item
    (skipping reasoning items).
    """
    text = payload.get("output_text")
    if isinstance(text, str) and text.strip():
        return text
    chunks: list[str] = []
    for item in payload.get("output", []) or []:
        if item.get("type") != "message":
            continue
        for part in item.get("content", []) or []:
            if part.get("type") in ("output_text", "text") and part.get("text"):
                chunks.append(part["text"])
    joined = "".join(chunks).strip()
    return joined or None


def _try_bodies(candidates: list[dict], extract) -> str | None:
    """Try each candidate body in order until one yields usable text.

    Moves on to the next (more stripped-down) body only when the gateway said a
    parameter was unsupported; stops on the first hard failure or real reply.
    """
    for body in candidates:
        payload, retryable = _send(body)
        if payload is not None:
            return extract(payload)
        if not retryable:
            return None
    return None


def ai_complete(
    system: str,
    user: str,
    *,
    temperature: float = 0.4,
    max_tokens: int = 900,
) -> str | None:
    """Call the configured chat model. Returns the text, or None on any failure.

    Supports both endpoint shapes Azure AI Foundry hands out:
      * Chat completions: ``.../chat/completions?api-version=...``
      * Responses API:     ``.../openai/v1/responses``
    The shape is chosen automatically from the endpoint URL. Failures (no model
    configured, network error, bad response) are swallowed on purpose so the app
    degrades gracefully to the deterministic report.
    """
    if not ai_available():
        return None

    # --- Responses API (newer Foundry "Target URI" for reasoning models) ---
    if "/responses" in FOUNDRY_ENDPOINT:
        base: dict = {
            "input": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if FOUNDRY_MODEL:
            base["model"] = FOUNDRY_MODEL
        candidates = [
            {**base, "temperature": temperature, "max_output_tokens": max_tokens},
            {**base, "max_output_tokens": max_tokens},  # some models reject temperature
        ]
        return _try_bodies(candidates, _extract_responses_text)

    # --- Chat completions (Azure OpenAI / model-inference Target URI) ---
    base = {
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    }
    if FOUNDRY_MODEL:
        base["model"] = FOUNDRY_MODEL
    # Newer reasoning models (o-series, gpt-5.x) require "max_completion_tokens"
    # and may reject a custom temperature; older chat models use "max_tokens".
    candidates = [
        {**base, "temperature": temperature, "max_completion_tokens": max_tokens},
        {**base, "max_completion_tokens": max_tokens},
        {**base, "temperature": temperature, "max_tokens": max_tokens},
        {**base, "max_tokens": max_tokens},
    ]
    return _try_bodies(candidates, _extract_chat_text)
