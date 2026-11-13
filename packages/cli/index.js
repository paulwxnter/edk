#!/usr/bin/env node
// @edks/cli: the EDK command line. `edk login`, then `edk search "bridges in Pittsburgh"`.
import { createInterface } from "node:readline";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = "0.1.0";
const CONFIG_DIR = join(homedir(), ".edk");
const CONFIG = join(CONFIG_DIR, "config.json");
const BASE = (process.env.EDK_BASE_URL || "https://api.edk.earth").replace(/\/+$/, "");
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = (s) => c(2, s), bold = (s) => c(1, s), ochre = (s) => c("38;5;179", s), moss = (s) => c("38;5;107", s);

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}
const apiKey = () => process.env.EDK_API_KEY || readConfig().apiKey || "";

async function api(method, path, { query, body } = {}) {
  const key = apiKey();
  if (!key) throw new Error("Not signed in. Run `edk login` or set EDK_API_KEY.");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${key}`, "x-edk-client": "cli", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

function parseArgs(argv) {
  const flags = {}, rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) flags[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) flags[k] = argv[++i];
      else flags[k] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const HELP = `${ochre("edk")} ${dim(VERSION)}  Compass for Machines

${bold("Usage")}
  edk login                          Save a secret API key (stored in ~/.edk)
  edk logout                         Remove the saved key
  edk search "<question>" [--limit 10] [--json] [--no-answer]
  edk inspect <lat>,<lng> [--json]   Everything known about the area at a point
  edk regions <name> [--type city]   Find regions
  edk geocode "<address>"            Coordinates for an address
  edk usage                          CU balance and this month's usage

Keys: https://edk.earth/console/keys · Docs: https://edk.earth/docs`;

async function main() {
  const [cmd, ...argv] = process.argv.slice(2);
  const { flags, rest } = parseArgs(argv);
  const json = Boolean(flags.json);
  const out = (data) => console.log(JSON.stringify(data, null, 2));

  switch (cmd) {
    case "login": {
      console.log(`Create a secret key at ${ochre("https://edk.earth/console/keys")}`);
      const key = flags.key || (await ask("Paste your key (edk_sk_…): ", true));
      if (!/^edk_sk_[A-Za-z0-9]{20,64}$/.test(key)) throw new Error("That doesn't look like a secret key (edk_sk_…).");
      process.env.EDK_API_KEY = key;
      const usage = await api("GET", "/v1/usage");
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(CONFIG, JSON.stringify({ apiKey: key }, null, 2));
      try {
        chmodSync(CONFIG, 0o600);
      } catch {}
      console.log(`${moss("✓")} Signed in. ${usage.balance_cu} CU available.`);
      return;
    }
    case "logout":
      writeFileSync(CONFIG, "{}");
      console.log("Signed out.");
      return;
    case "search": {
      const query = rest.join(" ");
      if (!query) throw new Error('Give a question, e.g. edk search "bridges in Pittsburgh"');
      const r = await api("POST", "/v1/search", { body: { query, limit: flags.limit ? Number(flags.limit) : 10, answer: !flags["no-answer"] } });
      if (json) return out(r);
      if (r.data.answer) console.log(`\n${r.data.answer}\n`);
      r.data.geojson.features.forEach((f, i) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const title = p.address || p.name || p.feature_name || "Result";
        const meta = [p.feature_name !== title ? p.feature_name : null, p.neighborhood || p.district, p.date ? String(p.date).slice(0, 10) : null].filter(Boolean).join(" · ");
        console.log(`${ochre(String(i + 1).padStart(2))}  ${bold(title)}${meta ? dim("  " + meta) : ""}\n    ${dim(`${lat?.toFixed(5)}, ${lng?.toFixed(5)}`)}${p.image_url ? dim("  " + p.image_url) : ""}`);
      });
      console.log(`\n${dim(`${r.data.geojson.features.length} results · ${r.usage.cu} CU · `)}${ochre(r.embed_url)}`);
      return;
    }
    case "inspect": {
      const [lat, lng] = rest.join(",").split(",").map((s) => Number(s.trim()));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Give a point: edk inspect 40.4406,-79.9959");
      const r = await api("GET", "/v1/inspect", { query: { lat, lng } });
      if (json) return out(r);
      const d = r.data;
      console.log(bold(d.place.map((p) => p.name).join(", ") || `${lat}, ${lng}`));
      for (const h of d.highlights ?? []) console.log(`  ${h.title}: ${ochre(h.value)}${h.detail ? dim(" " + h.detail) : ""}`);
      for (const cat of d.categories ?? []) {
        console.log(`\n${dim(cat.name.toUpperCase())}`);
        for (const item of cat.items.slice(0, 8)) console.log(`  ${item.title}: ${item.value}`);
      }
      return;
    }
    case "regions": {
      const r = await api("GET", "/v1/regions", { query: { q: rest.join(" "), type: flags.type } });
      if (json) return out(r);
      for (const g of r.data.regions ?? []) console.log(`${bold(g.name)} ${dim(`${g.type} · ${g.context ?? ""} · ${g.slug} · id ${g.id}`)}`);
      return;
    }
    case "geocode": {
      const r = await api("GET", "/v1/geocode", { query: { q: rest.join(" ") } });
      if (json) return out(r);
      for (const p of r.data.places ?? []) console.log(`${bold(p.address || p.name)} ${dim(`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`)}`);
      return;
    }
    case "usage": {
      const r = await api("GET", "/v1/usage");
      if (json) return out(r);
      console.log(`${bold(String(r.balance_cu))} CU available · ${r.month_cu} CU used this month${r.monthly_cu_cap ? ` of ${r.monthly_cu_cap}` : ""}`);
      return;
    }
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    default:
      console.log(HELP);
  }
}

main().catch((e) => {
  console.error(`${c(31, "✗")} ${e.message}`);
  process.exit(1);
});
