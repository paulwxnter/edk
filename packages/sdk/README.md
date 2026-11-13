# @edks/sdk

The EDK SDK. EDK is a compass for machines: one API for questions about the physical world (places, imagery, area facts and trends).

```sh
npm install @edks/sdk
```

```ts
import { EDK } from "@edks/sdk";

const edk = new EDK(); // reads EDK_API_KEY
const { data, usage, embed_url } = await edk.search("bridges in Pittsburgh", { limit: 10 });

console.log(data.answer);
console.log(data.geojson.features.length, "results,", usage.cu, "CU");
console.log("On the Atlas:", embed_url);
```

Also: `inspect({ lat, lng })`, `regions({ q })`, `geocode(q)`, `catalog({ q })`, `sources({ keys })`, `trends.series({ feature, regions, tf })`, `usage()`, `result(id)`.

Errors throw `EDKError` with `status` and `message`. Works in Node 18+, Bun, Deno and Workers.

Sign up at https://edk.earth (500 free CU) and create a key in the console. Docs: https://edk.earth/docs
