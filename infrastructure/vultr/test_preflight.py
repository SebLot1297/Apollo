"""Offline bounds for the documented conservative BF16 deployment."""

import contextlib
import importlib.util
import io
import sys
import unittest
from pathlib import Path

DIRECTORY = Path(__file__).parent


class PreflightTests(unittest.TestCase):
    def setUp(self):
        script = DIRECTORY / "preflight.py"
        if not script.exists():
            self.fail(
                "preflight.py is missing: operator config must be checked before startup"
            )
        sys.path.insert(0, str(DIRECTORY))
        self.addCleanup(sys.path.remove, str(DIRECTORY))
        spec = importlib.util.spec_from_file_location(
            "vultr_preflight_under_test", script
        )
        self.preflight = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.preflight)

    def test_defaults_validate_with_synthetic_key(self):
        self.preflight.validate_config({"VLLM_API_KEY": "synthetic-test-only"})

    def test_empty_key_refused(self):
        with self.assertRaisesRegex(self.preflight.SmokeFailure, "api_key_required"):
            self.preflight.validate_config({"VLLM_API_KEY": ""})

    def test_unpinned_image_and_revision_refused(self):
        for field, value in (
            ("VLLM_IMAGE", "vllm/vllm-openai:latest"),
            ("VLLM_IMAGE", "vllm/vllm-openai:nightly"),
            ("VLLM_MODEL_REVISION", "main"),
            ("VLLM_MODEL_REVISION", "abc"),
        ):
            with (
                self.subTest(field=field, value=value),
                self.assertRaises(self.preflight.SmokeFailure),
            ):
                self.preflight.validate_config(
                    {"VLLM_API_KEY": "synthetic-test-only", field: value}
                )

    def test_resource_bounds_refused(self):
        for field, value in (
            ("VLLM_MAX_MODEL_LEN", "32768"),
            ("VLLM_MAX_MODEL_LEN", "0"),
            ("VLLM_MAX_NUM_SEQS", "3"),
            ("VLLM_MAX_NUM_SEQS", "1.5"),
            ("VLLM_GPU_MEMORY_UTILIZATION", "NaN"),
            ("VLLM_GPU_MEMORY_UTILIZATION", "1"),
            ("VLLM_HOST_PORT", "65536"),
            ("VLLM_TENSOR_PARALLEL_SIZE", "0"),
        ):
            with (
                self.subTest(field=field, value=value),
                self.assertRaises(self.preflight.SmokeFailure),
            ):
                self.preflight.validate_config(
                    {"VLLM_API_KEY": "synthetic-test-only", field: value}
                )

    def test_cli_output_cannot_expose_invalid_values(self):
        secret = "synthetic-secret-not-live"
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            result = self.preflight.main(
                {"VLLM_API_KEY": "synthetic-test-only", "VLLM_IMAGE": secret}
            )
        self.assertEqual(result, 1)
        self.assertEqual(stderr.getvalue(), "FAIL image_not_versioned\n")
        self.assertNotIn(secret, stderr.getvalue())

    def test_oversize_numeric_setting_has_fixed_failure(self):
        with contextlib.redirect_stderr(io.StringIO()) as stderr:
            result = self.preflight.main(
                {"VLLM_API_KEY": "synthetic-test-only", "VLLM_HOST_PORT": "9" * 5000}
            )
        self.assertEqual(result, 1)
        self.assertEqual(stderr.getvalue(), "FAIL resource_setting_invalid\n")


if __name__ == "__main__":
    unittest.main()
