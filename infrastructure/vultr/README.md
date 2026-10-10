# Optional Qwen inference on Vultr

These files prepare CommandGrid's optional text inference server. Local verification uses synthetic credentials and fake HTTP responses. No Vultr instance was provisioned, container image pulled, model downloaded, GPU tested, or live inference performed.

The pinned image/model/GPU combination still needs runtime qualification. Provisioning, loading, GPU fit, latency, structured generation and real inference are **unverified**. Run paid/cloud steps only on infrastructure the operator has authorized.

## Verified references — 2026-10-10

| Setting | Prepared value and evidence |
| --- | --- |
| Model | `Qwen/Qwen3.8-27B` exists in the [official model card](https://huggingface.co/Qwen/Qwen3.8-27B). The [file tree](https://huggingface.co/Qwen/Qwen3.8-27B/tree/main) reports 55.6 GB and BF16 tensors. |
| Revision | Model and tokenizer both use [`1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0`](https://huggingface.co/Qwen/Qwen3.8-27B/commit/1d4bf0f2ff6012fd82039f2fa52739d0dd7c60c0), observed on the official repository. |
| Image | `vllm/vllm-openai:v0.28.0-cu129`; the [official release](https://github.com/vllm-project/vllm/releases/tag/v0.28.0) lists this CUDA 12.9 image and Transformers 5.15.0. The registry digest has not been resolved locally. |
| Compatibility basis | [vLLM's Qwen recipe](https://recipes.vllm.ai/Qwen/Qwen3.8-27B), updated 2026-10-08, documents text serving and requires Transformers >=5.8.0. Release 0.28.0 exceeds that documented prerequisite. This is documentation evidence, not a test of this exact checkpoint/image/GPU. |
| Server flags | [Versioned serve reference](https://docs.vllm.ai/en/v0.28.0/cli/serve/) documents language-only mode, chat template kwargs and explicit request/output logging controls. |
| Proposals | [Structured outputs](https://docs.vllm.ai/en/latest/features/structured_outputs/) documents `response_format.type=json_schema`. The smoke script validates a small schema; CommandGrid validates complete mission/objective schemas separately. |

Keep versioned image and full checkpoint revision together in the deployment record. After authorized image retrieval, record its immutable registry digest and use `VLLM_IMAGE=...:v0.28.0-cu129@sha256:...` for repeat deployments. An image tag alone is not an immutable digest. Requalify changed images, checkpoints, CUDA drivers or GPU layouts.

## Memory and concurrency

Defaults are BF16, 8,192 total context tokens, two concurrent sequences, tensor parallelism 1, and GPU memory utilization 0.85. Set sequences to 1 for initial fit checks. Prompt plus generated tokens must fit the context limit. CommandGrid uses no images; `--language-model-only` disables multimodal inputs.

Weight arithmetic is separate from runtime memory: `27 billion × 2 BF16 bytes = 54 billion bytes`, about 54 GB decimal or 50.3 GiB for nominal dense weights alone. This repository's reported files are about 55.6 GB; use the actual checkpoint, not rounded parameter arithmetic, when planning storage. CUDA contexts, activations, allocator fragmentation, compilation/CUDA graphs, KV and recurrent state require additional memory. Vision-related components and checkpoint packaging can also affect loading despite language-only serving.

A 24 GB GPU is unsuitable for this BF16 baseline. A quantized checkpoint would be a different model/revision requiring separate security, quality, kernel and fit validation; these files do not select one. Choose hardware after establishing the actual fit and operating margin. Neither a specific Vultr GPU size nor throughput is promised. Plan disk space for model files, Docker layers, compile cache, logs and retained rollback revisions; measure free RAM, VRAM and storage before startup.

## Network and secret boundary

The container listens on `0.0.0.0:8000` inside its dedicated bridge. The **only** published host port is `127.0.0.1:8001`; Docker's host network is not used. No distributed communication port is published.

The [vLLM security guide](https://docs.vllm.ai/en/latest/usage/security/) warns that `VLLM_API_KEY` authenticates selected API prefixes while ancillary routes remain unauthenticated. A key does not secure the whole HTTP server. Preserve loopback binding and firewall isolation for every route, including health, metrics, administrative and alternate inference routes. Do not attach untrusted containers to this bridge or allow container-subnet direct routing. Treat local host/container administrators as trusted: they can read container environment credentials.

Use Docker Engine **28.0.0 or newer**. [Docker's port documentation](https://docs.docker.com/engine/network/port-publishing/) notes that older releases can expose localhost-published ports to peers on the same L2 network. Keep NAT bridge defaults and audit custom routing/firewall settings.

Use an SSH key and restrict TCP 22 to the operator's trusted source CIDR in both applicable IPv4 and IPv6 firewall rules. Permit no public 8000/8001, NCCL/Gloo/Ray or other distributed ports. See [Vultr SSH keys](https://docs.vultr.com/products/orchestration/ssh-keys/add-ssh-keys) and [Vultr firewall rules](https://docs.vultr.com/products/network/firewall-groups/management/rules). Verify a second key-based SSH session before changing SSH or firewall policy; retain console access for recovery.

`.env` must stay private (`chmod 600`, trusted directory, no Git tracking). Keep keys backend-only. Request bodies, generated text and authorization headers are never printed by these scripts. Avoid sharing `docker inspect` or expanded `docker compose config`: both can expose environment secrets. Request/output/access logs are disabled and Docker logs rotate at 3 × 10 MB, but still treat startup/crash logs as private and review them before sharing.

## Host prerequisites and offline preflight

On an existing authorized Linux GPU host, require an NVIDIA driver compatible with the image's CUDA 12.9 runtime, NVIDIA Container Toolkit configured for Docker, Docker Compose with GPU support, Python 3.10+ and adequate VRAM/RAM/disk. Check the actual host image before installing anything; GPU images can include a preconfigured toolkit. Follow [Vultr's driver/toolkit guide](https://docs.vultr.com/how-to-downgrade-or-reinstall-nvidia-drivers-on-vultr-bare-metal-and-passthrough-gpu-instances) when needed. These commands inspect an existing installation and do not pull images:

```bash
nvidia-smi
nvidia-ctk --version
docker version
docker compose version
python3 --version
df -h
free -h
```

Copy this directory to the host, then work inside it. The following creates a private local key without displaying it:

```bash
umask 077
cp .env.example .env
python3 - <<'PY'
from pathlib import Path
import secrets
path = Path('.env')
text = path.read_text()
path.write_text(text.replace('VLLM_API_KEY=\n', 'VLLM_API_KEY=' + secrets.token_urlsafe(48) + '\n', 1))
PY
chmod 600 .env
```

Edit only the trusted local file as needed. `HF_TOKEN` is optional for this public checkpoint; if repository access requires it, use a narrowly scoped token. Avoid shell tracing (`set -x`). Export the file's trusted values for preflight, without printing them:

```bash
set -a
. ./.env
set +a
python3 preflight.py
docker compose --env-file .env -f compose.yml config --quiet
python3 -m unittest discover -s . -p 'test_*.py' -v
python3 -m py_compile smoke.py preflight.py
```

`preflight.py` checks a versioned image, a full revision, nonblank key, loopback port, at most 8K context, 1–2 sequences, 1–8 tensor-parallel GPUs and finite utilization between 0.1 and 0.9. It validates syntax and conservative bounds only. Confirm the tensor parallel count against the host's allocated compatible GPUs. Tests render Compose using synthetic values and call an in-process fake HTTP server on localhost; they never contact a model service. `config --quiet` validates the operator's effective Compose config without dumping it.

## Authorized startup and health

The next commands are cloud/runtime steps and were not executed during implementation. Confirm the selected GPU/driver fit and budget first. Pulling retrieves the large image; starting can download model weights. Named `huggingface-cache` and `vllm-cache` volumes preserve downloads and compilation cache across restarts.

```bash
docker compose --env-file .env -f compose.yml pull vllm
docker compose --env-file .env -f compose.yml up -d vllm
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail 100 vllm
```

Health checks call `/v1/models` twice: no key must fail; the configured key must list the model. They never generate text. A healthy metadata endpoint proves listing/auth reachability, not successful inference, latency or capacity. The 20-minute startup grace period is an operational allowance, not an ETA. Increase it only after reviewing actual download/load progress; unhealthy status does not automatically restart a Docker container.

Before accepting requests, verify the host publishes `127.0.0.1:8001` only (`docker compose port vllm 8000`) and confirm a connection from an untrusted external machine cannot reach the inference port. Do not infer isolation from an API key response alone.

## SSH tunnel and backend settings

On the machine running the backend, keep this tunnel open in a separate terminal. Replace the placeholder with the verified host and SSH user. OpenSSH must verify the server host key; do not disable host-key checking.

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -L 127.0.0.1:8001:127.0.0.1:8001 operator@VULTR_HOST
```

Use local environment injection for the same private inference key. Never put it in a URL, command argument, frontend config or `VITE_*` variable. Configure the backend's private environment:

```dotenv
ENABLE_AI=true
ENABLE_QWEN=true
QWEN_BASE_URL=http://127.0.0.1:8001/v1
QWEN_MODEL=Qwen/Qwen3.8-27B
# Set QWEN_API_KEY privately to the host's VLLM_API_KEY.
```

A backend running as a host process can use this loopback URL. A backend in Docker has its own loopback namespace: run the forwarding endpoint where that process can reach it, or design an authenticated private networking path with equivalent isolation. Do not silently switch the inference publication to a public address. After editing backend configuration, restart the backend; status may cache metadata briefly. See `docs/ai-providers.md` for routing and fallback semantics.

## Authorized metadata, text and schema smoke checks

On the backend/tunnel machine, securely inject `QWEN_API_KEY` into its process environment. The script uses that value or `VLLM_API_KEY`, requires a key, disables proxies and redirects, accepts HTTP only on loopback, and retains TLS certificate verification for HTTPS. Do not put credentials on the CLI.

```bash
python3 smoke.py --mode models
```

This is metadata only. Once generation is authorized, the next command sends exactly two small generation requests after the metadata/auth checks, with thinking disabled and a 128-token output budget each:

```bash
python3 smoke.py --mode all --allow-inference --timeout 60
```

Text must be nonblank with `finish_reason=stop`; schema output must strictly equal `{"status":"ok"}`. Duplicate keys, invalid/nonfinite JSON, missing model, malformed/truncated generation and oversized responses fail. Only fixed PASS/FAIL labels are printed, never prompt, response or key. The timeout applies to socket I/O, not an overall script deadline; slow incremental responses can extend elapsed time. Docker separately enforces a 12-second health-check deadline. Operators needing a total smoke deadline can use an outer process timeout. Individual text/schema modes are also available with `--allow-inference`. These small checks do not establish production throughput, long-context reliability or full CommandGrid schema support.

## Troubleshooting and rollback

| Symptom | Next action |
| --- | --- |
| `api_key_required` / Compose refuses configuration | Set a nonblank private key, run preflight again. Never substitute a shared example key. |
| `auth_not_enforced` | Stop accepting requests; verify effective vLLM auth and image. Keep port private. |
| `connection_failed` | Check tunnel process, loopback port, container health and local driver/load errors. |
| `auth_failed` | Synchronize backend/smoke key with host key; restart the host container after rotation. |
| `model_not_listed` | Check served model name and pinned revision. Metadata is not generation proof. |
| `generation_invalid` / `schema_invalid` | Inspect sanitized local diagnostics, validate chat template and structured-output support for the exact image. Do not accept truncated or unconstrained proposals. |
| GPU OOM or unhealthy startup | Stop restart loops, inspect VRAM and checkpoint overhead; try one sequence and remeasure. Reducing context does not make 54+ GB weights fit 24 GB. A changed GPU layout or quantized checkpoint needs a new qualification. |
| CUDA/kernel errors | Match driver/runtime/GPU architecture; requalify a documented versioned image. Do not enable arbitrary remote code to bypass loading errors. |

For immediate application rollback, set `ENABLE_QWEN=false` and restart the backend. Keep other AI configuration explicit; deterministic mock fallback remains labeled. Close the SSH tunnel when remote inference is no longer needed.

```bash
docker compose --env-file .env -f compose.yml stop vllm
docker compose --env-file .env -f compose.yml down
```

`down` preserves named caches. Keep the previous versioned image/digest, model revision and private config in an operator-controlled deployment record. To roll back a changed release, restore that qualified pair, rerun preflight, recreate the container, then rerun metadata and authorized generation checks. Do not use `down --volumes` or delete caches during routine rollback; cache deletion is a separate destructive operation. Rotate compromised keys locally and restart every consumer.

Public exposure requires a separate design: TLS, authentication on **all** proxy routes, an explicit allowlist limited to needed API paths, restrictive source firewalls, request/concurrency limits, private upstream and direct-port blocking. These files intentionally provide no public listener configuration.
