"""Render Compose with synthetic values only; never start or pull containers."""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

DIRECTORY = Path(__file__).parent


@unittest.skipUnless(shutil.which("docker"), "Docker Compose CLI is unavailable")
class DeploymentTests(unittest.TestCase):
    def render(self, key):
        config_path = DIRECTORY / "compose.yml"
        self.assertTrue(
            config_path.exists(), "secured inference Compose config is missing"
        )
        env = os.environ.copy()
        for name in tuple(env):
            if name.startswith(("VLLM_", "HF_")):
                env.pop(name)
        with tempfile.TemporaryDirectory() as temporary:
            synthetic = Path(temporary) / "synthetic.env"
            synthetic.write_text("VLLM_API_KEY=" + key + "\n", encoding="utf-8")
            return subprocess.run(
                [
                    "docker",
                    "compose",
                    "--project-directory",
                    str(DIRECTORY),
                    "--env-file",
                    str(synthetic),
                    "-f",
                    str(config_path),
                    "config",
                    "--format",
                    "json",
                ],
                env=env,
                text=True,
                capture_output=True,
                check=False,
                timeout=30,
            )

    def test_compose_exposes_only_loopback_http_and_keeps_revision_pinned(self):
        result = self.render("synthetic-offline-test-only")
        self.assertEqual(result.returncode, 0, result.stderr)
        services = json.loads(result.stdout)["services"]
        self.assertEqual(set(services), {"vllm"})
        service = services["vllm"]
        self.assertEqual(len(service["ports"]), 1)
        port = service["ports"][0]
        self.assertEqual(
            (port["host_ip"], str(port["published"]), port["target"]),
            ("127.0.0.1", "8001", 8000),
        )
        self.assertNotIn("network_mode", service)
        self.assertFalse(service.get("privileged", False))
        self.assertEqual(
            service["environment"]["VLLM_API_KEY"], "synthetic-offline-test-only"
        )
        self.assertRegex(
            service["image"], r"^vllm/vllm-openai:v\d+\.\d+\.\d+(?:-cu\d+)?$"
        )
        command = service["command"]
        self.assertEqual(command[command.index("--max-model-len") + 1], "8192")
        self.assertIn(command[command.index("--max-num-seqs") + 1], ("1", "2"))
        self.assertEqual(command[command.index("--dtype") + 1], "bfloat16")
        self.assertRegex(command[command.index("--revision") + 1], r"^[0-9a-f]{40}$")
        self.assertEqual(
            command[command.index("--tokenizer-revision") + 1],
            command[command.index("--revision") + 1],
        )
        self.assertIn("--no-enable-log-requests", command)
        self.assertIn("--no-enable-log-outputs", command)
        self.assertIn("--disable-uvicorn-access-log", command)

    def test_compose_refuses_missing_or_empty_api_key(self):
        result = self.render("")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("VLLM_API_KEY", result.stderr)


if __name__ == "__main__":
    unittest.main()
