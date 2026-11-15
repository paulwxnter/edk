# @edks/sdk

The SDK for EDK-1, a spatial model that gives humans and machines a compass for the world: position, condition, motion, navigation, stream and vision.

```sh
npm install @edks/sdk
```

```ts
import { EDK } from "@edks/sdk";

const edk = new EDK(); // reads EDK_API_KEY

const { data, usage, embed_url } = await edk.discover("bridges in Pittsburgh", { limit: 10 });
const spot = await edk.inspect({ lat: 40.4406, lng: -79.9959 });
```

`discover(query, { limit, reasoning, answer, areas, focus })`, `inspect({ lat, lng })`, `result(id)`, `usage()`. Errors throw `EDKError` with `status`.

`reasoning` is `"fast"` (default), `"low"`, `"medium"` or `"max"`: how closely EDK-1 studies its results before returning them. Studied results carry `boxed_image_url`, the picture with the feature outlined. Medium and max cost twice the CU.

Sign up at https://edk.earth (120 free CU every month). Docs: https://edk.earth/docs
