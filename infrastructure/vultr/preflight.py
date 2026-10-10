#!/usr/bin/env python3
"""Validate private environment settings offline, without printing their values."""

import math
import os
import re
import sys

from smoke import MODEL, SmokeConfig, SmokeFailure

REVISION = "1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0"
IMAGE = "vllm/vllm-openai:v0.28.0-cu129"


def _integer(environ, name, default, minimum, maximum):
    value = environ.get(name, default)
    if (
        not isinstance(value, str)
        or len(value) > 5
        or not value.isascii()
        or not value.isdigit()
    ):
        raise SmokeFailure("resource_setting_invalid")
    number = int(value)
    if not minimum <= number <= maximum:
        raise SmokeFailure("resource_setting_invalid")
    return number


def validate_config(environ):
    image = environ.get("VLLM_IMAGE", IMAGE)
    if not re.fullmatch(
        r"vllm/vllm-openai:v\d+\.\d+\.\d+(?:-cu\d+)?(?:-ubuntu\d+)?(?:@sha256:[0-9a-f]{64})?",
        image,
    ):
        raise SmokeFailure("image_not_versioned")
    if not re.fullmatch(r"[0-9a-f]{40}", environ.get("VLLM_MODEL_REVISION", REVISION)):
        raise SmokeFailure("revision_not_pinned")
    model = environ.get("VLLM_MODEL", MODEL)
    if model != MODEL:
        raise SmokeFailure("model_requires_separate_qualification")
    port = _integer(environ, "VLLM_HOST_PORT", "8001", 1, 65535)
    _integer(environ, "VLLM_MAX_MODEL_LEN", "8192", 256, 8192)
    _integer(environ, "VLLM_MAX_NUM_SEQS", "2", 1, 2)
    _integer(environ, "VLLM_TENSOR_PARALLEL_SIZE", "1", 1, 8)
    try:
        utilization = float(environ.get("VLLM_GPU_MEMORY_UTILIZATION", "0.85"))
    except (TypeError, ValueError):
        raise SmokeFailure("resource_setting_invalid") from None
    if not math.isfinite(utilization) or not 0.1 <= utilization <= 0.9:
        raise SmokeFailure("resource_setting_invalid")
    SmokeConfig(f"http://127.0.0.1:{port}/v1", environ.get("VLLM_API_KEY", ""), model)


def main(environ=None):
    try:
        validate_config(os.environ if environ is None else environ)
    except SmokeFailure as error:
        print("FAIL " + str(error), file=sys.stderr)
        return 1
    print("PASS config (offline; GPU/runtime not checked)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
