# @sgrs/sgrs-client (TypeScript)

HTTP client for the **SGRS Governed Swarm** control plane (`/v1`). Point it at your swarm **control plane** URL—on-prem or in the cloud—and drive scopes, documents, runtime, and metrics from your own agents or services.

Published under the [npm **`sgrs`** organization](https://www.npmjs.com/org/sgrs).

## Install

```bash
npm install @sgrs/sgrs-client
```

## Usage

```ts
import { createSgrsClient } from "@sgrs/sgrs-client";

const client = createSgrsClient({
  baseUrl: "https://your-control-plane.example.com",
  apiKey: process.env.SWARM_API_KEY!,
});

await client.runtimeStart("scope-id");
```

## Python

The paired Python package lives in `packages/sgrs-client-py` (PyPI name **`sgrs-client`**, import **`sgrs_client`**).

## License

[MIT](LICENSE). The main kernel / orchestration code in this repository is licensed separately (AGPL-3.0-only); these client libraries are permissive so you can embed them in proprietary or open stacks that talk to your own swarm deployment.
