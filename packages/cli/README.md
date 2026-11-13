# @edks/cli

Ask EDK about the physical world from your terminal.

```sh
npm install -g @edks/cli

edk login                                   # paste a secret key from https://edk.earth/console/keys
edk search "bridges in Pittsburgh" --limit 10
edk search "solar farms near Phoenix" --json > farms.json
edk inspect 40.4406,-79.9959
edk regions austin --type city
edk usage
```

`EDK_API_KEY` in the environment takes precedence over the saved key. Docs: https://edk.earth/docs#cli
