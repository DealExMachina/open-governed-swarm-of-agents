# sgrs-kernel-client (Python, internal)

HTTP client for the **SGRS kernel control plane** (`/v1`), intended for internal wiring and migration tooling.

For external/public integrations, use the product clients from the `sgrs` repository (`@sgrs/client-ts` and `sgrs-client`).

## Install

```bash
pip install sgrs-kernel-client
```

Optional NATS helpers:

```bash
pip install 'sgrs-kernel-client[nats]'
```

## Usage

```python
from sgrs_client import KernelClient

with KernelClient("https://your-control-plane.example.com", api_key) as client:
    client.runtime_start("scope-id")
```

`SgrsClient` and `SwarmControlPlaneClient` remain available as aliases for compatibility.

## TypeScript

See npm package **`@sgrs/kernel-client`** (`packages/sgrs-client` in this repo).

## License

[MIT](LICENSE). The main kernel / orchestration code in this repository is licensed separately (AGPL-3.0-only); these client libraries are permissive so you can embed them in proprietary or open stacks that talk to your own swarm deployment.
