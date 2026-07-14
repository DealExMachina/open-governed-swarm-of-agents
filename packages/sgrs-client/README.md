# @sgrs/kernel-client (TypeScript, internal)

HTTP client for the **SGRS kernel control plane** (`/v1`), intended for internal wiring and migration tooling.

For external/public integrations, use the product clients from the `sgrs` repository (`@sgrs/client-ts` and `sgrs-client`).

## Install

```bash
npm install @sgrs/kernel-client
```

## Usage

```ts
import { createKernelClient } from "@sgrs/kernel-client";

const client = createKernelClient({
  baseUrl: "https://your-control-plane.example.com",
  apiKey: process.env.SWARM_API_KEY!,
});

await client.runtimeStart("scope-id");
```

## Python

The paired Python package lives in `packages/sgrs-client-py` (PyPI name **`sgrs-kernel-client`**, import **`sgrs_client`**).

## License

[MIT](LICENSE). The main kernel / orchestration code in this repository is licensed separately (AGPL-3.0-only); these client libraries are permissive so you can embed them in proprietary or open stacks that talk to your own swarm deployment.
