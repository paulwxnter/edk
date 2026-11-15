#!/usr/bin/env node
// @edks/cli: the EDK-1 command line. `edk login`, then `edk discover "bridges in Pittsburgh"`.
import { createInterface } from "node:readline";
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const VERSION = "0.5.0";
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

const HELP = `${ochre("edk")} ${dim(VERSION)}  EDK-1, compass for machines

${bold("Usage")}
  edk login                            Save a secret API key (stored in ~/.edk)
  edk logout                           Remove the saved key
  edk discover "<question>" [--limit 10] [--reasoning fast|low|medium|max] [--answer] [--json]
  edk inspect <lat>,<lng> [--json]     What is known about the area at a point
  edk route "<from>" "<to>" [--include "a coffee shop"] [--avoid "pothole streets"] [--profile driving] [--json]
  edk monitor list                     Your monitors (Tier 4 and above)
  edk monitor create --artifact "Building Permit" --area Pittsburgh [--since 2026-11-01] [--every 1h] [--webhook https://…]
  edk monitor events <id>              New events a monitor found
  edk usage                            Balance, tier and limits

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
    case "discover":
    case "search": {
      const query = rest.join(" ");
      if (!query) throw new Error('Give a question, e.g. edk discover "bridges in Pittsburgh"');
      const r = await api("POST", "/v1/discover", { body: { query, limit: flags.limit ? Number(flags.limit) : 10, answer: Boolean(flags.answer), ...(typeof flags.reasoning === "string" ? { reasoning: flags.reasoning } : {}) } });
      if (json) return out(r);
      if (r.data.answer) console.log(`\n${r.data.answer}\n`);
      r.data.geojson.features.forEach((f, i) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const title = p.name || p.address || p.feature_name || "Result";
        const meta = [p.kind === "area" ? "Area" : p.feature_name !== title ? p.feature_name : null, p.neighborhood || p.district, p.date, typeof p.distance === "number" ? `${p.distance} m` : null, ...(p.facts ?? []).map((f) => [f.title, f.detail || f.value].filter(Boolean).join(": ")), p.insight].filter(Boolean).join(" · ");
        console.log(`${ochre(String(i + 1).padStart(2))}  ${bold(title)}${meta ? dim("  " + meta) : ""}\n    ${dim(`${lat?.toFixed(5)}, ${lng?.toFixed(5)}`)}${p.boxed_image_url || p.image_url ? dim("  " + (p.boxed_image_url || p.image_url)) : ""}`);
      });
      console.log(`\n${dim(`${r.data.geojson.features.length} results · ${r.usage.cu} CU · `)}${ochre(r.embed_url)}`);
      return;
    }
    case "route": {
      const [from, to] = rest;
      if (!from || !to) throw new Error('Give a start and an end: edk route "Point State Park, Pittsburgh" "Carnegie Mellon University" --avoid "pothole streets"');
      const conditions = typeof flags.avoid === "string" ? flags.avoid : typeof flags.conditions === "string" ? flags.conditions : undefined;
      const include = typeof flags.include === "string" ? flags.include : undefined;
      const r = await api("POST", "/v1/route", { body: { from, to, include, conditions, profile: typeof flags.profile === "string" ? flags.profile : undefined } });
      if (json) return out(r);
      const d = r.data;
      const km = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
      const min = (s) => `${Math.max(1, Math.round(s / 60))} min`;
      console.log(`${bold(d.from.label || `${d.from.lat}, ${d.from.lng}`)} ${dim("→")} ${bold(d.to.label || `${d.to.lat}, ${d.to.lng}`)}`);
      console.log(`  ${ochre(km(d.route.distance_m))} · ${ochre(min(d.route.duration_s))}${d.direct ? dim(`  (direct: ${km(d.direct.distance_m)}, ${min(d.direct.duration_s)})`) : ""}`);
      if (d.included?.length) console.log(`  Passes ${d.included.map((h) => ochre(h.name)).join(", ")}`);
      if (d.conditions) console.log(`  Avoided ${ochre(String(d.avoided.length))} of ${d.conditions.matches} ${d.conditions.looked_for.join(", ").toLowerCase()} known in ${d.conditions.cities.join(" and ") || "the area"}`);
      if (d.note) console.log(dim(`  ${d.note}`));
      console.log("");
      d.route.steps.filter((s) => s.instruction).forEach((s, i) => console.log(`${dim(String(i + 1).padStart(2))}  ${s.instruction}${s.distance_m ? dim("  " + km(s.distance_m)) : ""}`));
      console.log(`\n${dim(`${r.usage.cu} CU`)}`);
      return;
    }
    case "monitor":
    case "monitors": {
      const [sub = "list", id] = rest;
      if (sub === "list") {
        const r = await api("GET", "/v1/monitors");
        if (json) return out(r);
        if (!r.data.length) return console.log(dim("No monitors yet. edk monitor create --artifact \"Building Permit\" --area Pittsburgh"));
        for (const m of r.data) console.log(`${ochre(m.id)}  ${bold(m.name)}  ${dim(`${m.status} · ${m.events} events · every ${m.interval_minutes} min`)}`);
        return;
      }
      if (sub === "create") {
        const artifacts = [flags.artifact, flags.artifacts].filter((v) => typeof v === "string").flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
        if (!artifacts.length || typeof flags.area !== "string") throw new Error('Give --artifact and --area, e.g. edk monitor create --artifact "Building Permit" --area Pittsburgh');
        const r = await api("POST", "/v1/monitors", { body: { artifacts, area: flags.area, since: flags.since, interval: flags.every ?? flags.interval, webhook_url: flags.webhook, prompt: flags.prompt, name: flags.name } });
        if (json) return out(r);
        console.log(`${moss("✓")} ${bold(r.name)} ${dim(r.id)}\n  ${r.area.name} · every ${r.interval_minutes} min · since ${r.since.slice(0, 10)}`);
        if (r.webhook_url) console.log(`  Webhook secret: ${ochre(r.webhook_secret)}`);
        return;
      }
      if (sub === "events") {
        if (!id) throw new Error("Give a monitor id: edk monitor events mon_…");
        const r = await api("GET", `/v1/monitors/${encodeURIComponent(id)}/events`, { query: { limit: flags.limit } });
        if (json) return out(r);
        if (!r.data.length) return console.log(dim("No events yet."));
        for (const e of r.data) console.log(`${dim((e.occurred_at || e.detected_at).slice(0, 10))}  ${bold(e.title || e.artifact.name)}${e.address ? dim("  " + e.address) : ""}`);
        return;
      }
      throw new Error("Use edk monitor list, create or events.");
    }
    case "inspect": {
      const [lat, lng] = rest.join(",").split(",").map((s) => Number(s.trim()));
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("Give a point: edk inspect 40.4406,-79.9959");
      const r = await api("GET", "/v1/inspect", { query: { lat, lng } });
      if (json) return out(r);
      const d = r.data;
      console.log(bold(d.place.map((p) => p.name).join(", ") || `${lat}, ${lng}`));
      for (const h of d.highlights ?? []) console.log(`  ${h.title}: ${ochre(h.detail || h.value || "")}`);
      for (const cat of d.categories ?? []) {
        console.log(`\n${dim(cat.name.toUpperCase())}`);
        for (const item of cat.items.slice(0, 8)) console.log(`  ${item.title}: ${item.value}`);
      }
      return;
    }
    case "usage": {
      const r = await api("GET", "/v1/usage");
      if (json) return out(r);
      console.log(`${bold(String(r.balance_cu))} CU available · ${r.month_cu} CU used this month${r.monthly_cu_cap ? ` of ${r.monthly_cu_cap}` : ""}`);
      if (r.tier) console.log(dim(`${r.tier.name}: up to ${r.tier.max_results} results per request, ${r.tier.concurrency} at once`));
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
