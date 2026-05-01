# sgrs-client (Python)

HTTP client for the **SGRS Governed Swarm** control plane (`/v1`). Use it to integrate **your** agents with a swarm runtime (**on-prem or cloud**) without pulling in the full stack.

## Install

```bash
pip install sgrs-client
```

Optional NATS helpers:

```bash
pip install 'sgrs-client[nats]'
```

## Usage

```python
from sgrs_client import SgrsClient

with SgrsClient("https://your-control-plane.example.com", api_key) as client:
    client.runtime_start("scope-id")
```

`SwarmControlPlaneClient` remains available as an alias for `SgrsClient`.

## TypeScript

See npm package **`@sgrs/sgrs-client`** (`packages/sgrs-client` in this repo).

## License

[MIT](LICENSE). The main kernel / orchestration code in this repository is licensed separately (AGPL-3.0-only); these client libraries are permissive so you can embed them in proprietary or open stacks that talk to your own swarm deployment.
