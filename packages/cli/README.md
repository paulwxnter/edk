# @edks/cli

EDK-1 from your terminal: Discover places and Inspect any spot.

```sh
npm install -g @edks/cli

edk login                                     # paste a secret key from https://edk.earth/console/keys
edk discover "bridges in Pittsburgh" --limit 10
edk discover "graffiti in San Francisco" --reasoning medium
edk discover "high income areas in Denver" --json > areas.json
edk inspect 40.4406,-79.9959
edk usage
```

`EDK_API_KEY` in the environment takes precedence over the saved key. Docs: https://edk.earth/docs#cli
