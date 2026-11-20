#!/usr/bin/env node
// Builds every image on the profile from live GitHub data: no third-party card services, no dependencies.
//   GITHUB_TOKEN=... node scripts/build.mjs        (locally, `gh auth token` is used when the variable is unset)
//   node scripts/build.mjs --offline                (re-render from the last snapshot in assets/data.json)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = (...p) => join(ROOT, "assets", ...p);
const LOGIN = "AXRoux";

// ---------------------------------------------------------------- palette
const DARK = {
  name: "dark",
  bg: "#07090d",
  panel: "#0c1017",
  panelTop: "#0f141d",
  panelBottom: "#0a0d13",
  highlight: "rgba(255,255,255,0.025)",
  chip: "rgba(255,255,255,0.04)",
  dot: "#ffffff",
  dotOpacity: 0.07,
  ruleColor: "#ffffff",
  track: "#3a4256",
  nodeFill: "#0b0f16",
  heat: ["#141a24", "#16305f", "#1f4fa8", "#3d7fff", "#9cc0ff"],
  line: "rgba(255,255,255,0.08)",
  line2: "rgba(255,255,255,0.14)",
  text: "#eef2f8",
  soft: "#b4bccc",
  muted: "#8a93a6",
  dim: "#5d6679",
  accent: "#3d7fff",
  accent2: "#8db3ff",
  green: "#3ddc97",
  amber: "#f5b84a",
  red: "#ff6b6b",
  violet: "#8b7bff",
};
const LIGHT = {
  ...DARK,
  name: "light",
  bg: "#ffffff",
  panel: "#ffffff",
  panelTop: "#ffffff",
  panelBottom: "#f6f8fb",
  highlight: "rgba(255,255,255,0.9)",
  chip: "rgba(15,23,42,0.035)",
  dot: "#0b1220",
  dotOpacity: 0.06,
  ruleColor: "#0b1220",
  track: "#d5dbe5",
  nodeFill: "#ffffff",
  heat: ["#edf1f6", "#c9dafd", "#8fb2ff", "#3d7fff", "#1c4fd6"],
  line: "rgba(15,23,42,0.09)",
  line2: "rgba(15,23,42,0.16)",
  text: "#0b1220",
  soft: "#334155",
  muted: "#556074",
  dim: "#8792a6",
  accent: "#2b6cf0",
  accent2: "#2b6cf0",
  green: "#0e9f6e",
  amber: "#c98a0a",
};
let C = DARK;

// ---------------------------------------------------------------- fonts and measuring
const METRICS = JSON.parse(readFileSync(A("fonts", "metrics.json"), "utf8"));
const fontFace = (key) => {
  const [family, weight] = key.split("-");
  const data = readFileSync(A("fonts", `${key}.woff2`)).toString("base64");
  return `@font-face{font-family:${family === "sans" ? "GS" : "GM"};font-weight:${weight};src:url(data:font/woff2;base64,${data}) format("woff2")}`;
};
/** Width of `text` in px, set in font `key` ("sans-600") at `size`, with optional letter spacing. */
function measure(text, key, size, tracking = 0) {
  const m = METRICS[key];
  let w = 0;
  for (const ch of text) w += m.w[ch] ?? m.default;
  return w * size + tracking * Math.max(0, [...text].length - 1);
}
/** Greedy word wrap to `max` px. */
function wrap(text, key, size, max) {
  const lines = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next, key, size) > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const SANS = "GS,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "GM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";

/** A text element. f: "sans-600" etc. */
function t(x, y, text, { f = "sans-400", size = 14, fill = C.text, anchor, tracking, opacity, cls, raw = false } = {}) {
  const [family, weight] = f.split("-");
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-family="${family === "sans" ? SANS : MONO}"`,
    `font-weight="${weight}"`,
    `font-size="${size}"`,
    `fill="${fill}"`,
    anchor ? `text-anchor="${anchor}"` : "",
    tracking ? `letter-spacing="${tracking}"` : "",
    opacity !== undefined ? `opacity="${opacity}"` : "",
    cls ? `class="${cls}"` : "",
  ].filter(Boolean);
  return `<text ${attrs.join(" ")}>${raw ? text : esc(text)}</text>`;
}
const tspan = (text, attrs = "") => `<tspan ${attrs}>${esc(text)}</tspan>`;

// ---------------------------------------------------------------- icons and brand marks
/** A single-colour logo from assets/icons, as a nested svg filled with `color`. */
function icon(name, x, y, size, color = C.text, opacity = 1) {
  const src = readFileSync(A("icons", `${name}.svg`), "utf8");
  const viewBox = src.match(/viewBox="([^"]+)"/)[1];
  const rule = src.match(/<svg[^>]*fill-rule="([^"]+)"/)?.[1];
  const inner = src
    .replace(/^[\s\S]*?<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .replace(/<title>[\s\S]*?<\/title>/g, "");
  const [, , vw, vh] = viewBox.split(/\s+/).map(Number);
  const h = (size * vh) / vw;
  return `<svg x="${x}" y="${y + (size - Math.min(size, h)) / 2}" width="${size}" height="${Math.min(size, h)}" viewBox="${viewBox}" fill="${color}" opacity="${opacity}"${rule ? ` fill-rule="${rule}"` : ""} preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}
/** A full-colour brand mark from assets/brand, isolated as a data URI so its ids cannot collide. */
function brand(file, x, y, size) {
  const buf = readFileSync(A("brand", file));
  const mime = file.endsWith(".png") ? "image/png" : "image/svg+xml";
  return `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:${mime};base64,${buf.toString("base64")}"/>`;
}

// ---------------------------------------------------------------- frame
function svg(w, h, body, { fonts = [], css = "", title = "" } = {}) {
  // STATIC=1 renders the final frame without motion (for previews and for any renderer that skips CSS animation).
  const style = [...new Set(fonts)].map(fontFace).join("") + (process.env.STATIC ? "" : css);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${style}</style>
<defs>
  <pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.1" fill="${C.dot}" opacity="${C.dotOpacity}"/></pattern>
  <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.panelTop}"/><stop offset="1" stop-color="${C.panelBottom}"/></linearGradient>
  <linearGradient id="rule" x1="0" x2="1"><stop offset="0" stop-color="${C.ruleColor}" stop-opacity="0"/><stop offset="0.5" stop-color="${C.ruleColor}" stop-opacity="0.14"/><stop offset="1" stop-color="${C.ruleColor}" stop-opacity="0"/></linearGradient>
  <linearGradient id="accentFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.accent}" stop-opacity="0.45"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></linearGradient>
  <radialGradient id="glowBlue" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.accent}" stop-opacity="0.32"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></radialGradient>
  <radialGradient id="glowViolet" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${C.violet}" stop-opacity="0.18"/><stop offset="1" stop-color="${C.violet}" stop-opacity="0"/></radialGradient>
  <linearGradient id="name" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#b9cdfc"/></linearGradient>
</defs>
${body}
</svg>`;
}
/** A rounded card with the panel gradient and a hairline border. */
const card = (x, y, w, h, r = 18) =>
  `<rect x="${x + 0.5}" y="${y + 0.5}" width="${w - 1}" height="${h - 1}" rx="${r}" fill="url(#panel)" stroke="${C.line}"/>` +
  `<rect x="${x + 1.5}" y="${y + 1.5}" width="${w - 3}" height="${h - 3}" rx="${r - 1}" fill="none" stroke="${C.highlight}"/>`;
/** A pill with centred text. Returns [markup, width]. */
function pill(x, y, text, { f = "mono-500", size = 11, tracking = 1.2, fill = C.soft, bg = C.chip, border = C.line2, padX = 12, h = 26, dot } = {}) {
  const tw = measure(text, f, size, tracking);
  const dotW = dot ? 14 : 0;
  const w = Math.round(tw + padX * 2 + dotW);
  const parts = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="${bg}" stroke="${border}"/>`];
  if (dot) parts.push(`<circle cx="${x + padX + 3}" cy="${y + h / 2}" r="3.2" fill="${dot}"/>`);
  parts.push(t(x + padX + dotW, y + h / 2 + size * 0.36, text, { f, size, fill, tracking }));
  return [parts.join(""), w];
}

// ---------------------------------------------------------------- data
async function fetchData() {
  // PROFILE_TOKEN (a fine-grained token, optional) wins over the workflow token; locally the gh CLI login is used.
  const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN || execSync("gh auth token", { encoding: "utf8" }).trim();
  const query = `query($login:String!){ user(login:$login){
    createdAt followers{totalCount}
    repositories(ownerAffiliations:OWNER, privacy:PUBLIC, isFork:false, first:100, orderBy:{field:STARGAZERS,direction:DESC}){
      totalCount nodes{ name stargazerCount forkCount pushedAt primaryLanguage{name color} } }
    contributionsCollection{ contributionCalendar{ totalContributions weeks{ contributionDays{ date contributionCount } } } }
  } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "axroux-profile" },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub GraphQL: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  const u = json.data.user;
  const repos = u.repositories.nodes;
  const days = u.contributionsCollection.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  const languages = {};
  for (const r of repos) if (r.primaryLanguage) {
    const l = (languages[r.primaryLanguage.name] ??= { name: r.primaryLanguage.name, color: r.primaryLanguage.color ?? C.muted, repos: 0 });
    l.repos++;
  }
  return {
    since: new Date(u.createdAt).getUTCFullYear(),
    followers: u.followers.totalCount,
    publicRepos: u.repositories.totalCount,
    stars: repos.reduce((s, r) => s + r.stargazerCount, 0),
    forks: repos.reduce((s, r) => s + r.forkCount, 0),
    contributions: u.contributionsCollection.contributionCalendar.totalContributions,
    days: days.map((d) => [d.date, d.contributionCount]),
    repos: Object.fromEntries(repos.map((r) => [r.name, { stars: r.stargazerCount, forks: r.forkCount, language: r.primaryLanguage }])),
    repoLanguages: repos.map((r) => r.primaryLanguage?.color ?? null),
    languages: Object.values(languages).sort((a, b) => b.repos - a.repos),
  };
}

// ---------------------------------------------------------------- content
const FEATURED = [
  {
    repo: "tessera",
    title: "Tessera",
    mark: { brand: "tessera-mark.png" },
    kicker: "AGENT PAYMENTS · AIRWALLEX × VISA",
    badge: { text: "HACKATHON BUILD", color: C.accent2 },
    desc: "The control layer between AI agents and a treasury. A policy-gated MCP toolbox lets any agent work payment incidents without ever paying a supplier twice.",
    tags: ["MCP", "Policy as code", "57/57 attacks held"],
  },
  {
    repo: "OSINT-Assistant",
    title: "OSINT Assistant",
    mark: { icon: "perplexity" },
    kicker: "RESEARCH AGENT · PERPLEXITY SONAR",
    badge: { text: "MOST STARRED", color: C.amber },
    desc: "AI-enhanced open-source intelligence: collects from many sources, recognises entities, maps their connections and writes the report. CLI and web app.",
    tags: ["Entity graphs", "Reporting"],
  },
  {
    repo: "argus-os",
    title: "Argus",
    mark: { brand: "argus-icon.svg" },
    kicker: "AUTONOMOUS OSINT · STRATIR",
    badge: { text: "AGENTIC LOOP", color: C.green },
    desc: "Intelligence orchestration for zero-human operations. Ask in plain language; the agent plans the investigation, runs WHOIS, DNS, Shodan and the web, and cross-checks every finding.",
    tags: ["Self-hosted", "Pluggable adapters"],
  },
  {
    repo: "veronica-osint",
    title: "Veronica",
    mark: { brand: "vero-logo-white.svg" },
    kicker: "INVESTIGATIVE COPILOT · GEMINI",
    badge: { text: "FROM VERO", color: C.green },
    desc: "Screens entities against global sanctions and watchlists, reasons about what it finds and suggests the next step. The engine of Stratir's VERO platform, open-sourced.",
    tags: ["Function calling", "Terminal"],
  },
  {
    repo: "meridian",
    title: "MERIDIAN",
    mark: { icon: "mistral" },
    kicker: "MULTI-AGENT DECISIONS · MISTRAL × ELEVENLABS",
    badge: { text: "HACKATHON BUILD", color: C.accent2 },
    desc: "Three agents argue a decision: one makes the case for, one against, and a third delivers the verdict, each in its own voice. Three minds, one decision, zero bias.",
    tags: ["Debate agents", "Voice"],
  },
  {
    repo: "signal-canvas",
    title: "Signal Canvas",
    mark: { brand: "signal-canvas.svg" },
    kicker: "INVESTIGATION CONSOLE · HERMES × NVIDIA × STRIPE",
    badge: { text: "HACKATHON BUILD", color: C.accent2 },
    desc: "A native macOS desk for NGOs: monitor sources, map actors on a graph and brief partners, with an agent at your side and every case encrypted on disk.",
    tags: ["Human-in-the-loop", "Tauri"],
  },
];

const STACK = [
  {
    label: "FRONTIER LABS",
    items: [
      ["openai", "OpenAI"], ["anthropic", "Anthropic"], ["deepmind", "Google DeepMind"], ["xai", "xAI"],
      ["spacex", "SpaceX", 1.7], ["meta", "Meta AI"], ["mistral", "Mistral AI"], ["nvidia", "NVIDIA"],
    ],
  },
  {
    label: "AGENTS & ORCHESTRATION",
    items: [
      ["langchain", "LangChain"], ["langgraph", "LangGraph"], ["mcp", "Model Context Protocol"], ["crewai", "CrewAI"],
      ["nousresearch", "Nous Research"], ["huggingface", "Hugging Face"], ["perplexity", "Perplexity"], ["elevenlabs", "ElevenLabs"],
    ],
  },
  {
    label: "RAILS & INFRASTRUCTURE",
    items: [
      ["aws", "AWS"], ["cloudflare", "Cloudflare"], ["vercel", "Vercel"], ["stripe", "Stripe"],
      ["visa", "Visa"], ["airwallex", "Airwallex"], ["cursor", "Cursor"], ["githubcopilot", "GitHub Copilot"],
    ],
  },
];

const W = 1280;

// ---------------------------------------------------------------- hero
function hero(d) {
  const H = 460;
  const fonts = ["sans-700", "sans-500", "sans-400", "mono-400", "mono-500"];
  const css = `
    .ln{animation:rv 16s cubic-bezier(.2,.7,.2,1) infinite both}
    @keyframes rv{0%{opacity:0;transform:translateX(-8px)}3%{opacity:1;transform:none}90%{opacity:1}96%,100%{opacity:0}}
    .pulse{animation:pl 2s ease-in-out infinite}
    @keyframes pl{0%,100%{opacity:1}50%{opacity:.35}}
    .ring{transform-origin:center;transform-box:fill-box;animation:rg 2s ease-out infinite}
    @keyframes rg{0%{transform:scale(1);opacity:.6}100%{transform:scale(3);opacity:0}}
    .cur{animation:bk 1.1s steps(1) infinite}
    @keyframes bk{50%{opacity:0}}
    .scan{animation:sc 6s linear infinite}
    @keyframes sc{0%{transform:translateY(0)}100%{transform:translateY(${H}px)}}`;
  const b = [];
  b.push(`<clipPath id="heroClip"><rect width="${W}" height="${H}" rx="24"/></clipPath><g clip-path="url(#heroClip)">`);
  b.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/><rect width="${W}" height="${H}" fill="url(#dots)"/>`);
  b.push(`<ellipse cx="260" cy="70" rx="620" ry="380" fill="url(#glowBlue)"/><ellipse cx="1120" cy="470" rx="520" ry="300" fill="url(#glowViolet)"/>`);
  b.push(`<rect class="scan" x="0" y="-80" width="${W}" height="80" fill="url(#accentFade)" opacity="0.06"/>`);
  b.push(`</g><rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="24" fill="none" stroke="${C.line}"/>`);

  // top strip
  b.push(t(56, 50, "AXROUX · PROFILE 01", { f: "mono-500", size: 12, fill: C.dim, tracking: 2.4 }));
  const status = "ONLINE · SHIPPING AGENTS";
  const sw = measure(status, "mono-500", 12, 2.4);
  b.push(`<circle cx="${W - 56 - sw - 16}" cy="46" r="4" fill="${C.green}" class="pulse"/><circle cx="${W - 56 - sw - 16}" cy="46" r="4" fill="none" stroke="${C.green}" class="ring"/>`);
  b.push(t(W - 56, 50, status, { f: "mono-500", size: 12, fill: C.soft, tracking: 2.4, anchor: "end" }));
  b.push(`<rect x="56" y="70" width="${W - 112}" height="1" fill="url(#rule)"/>`);

  // identity
  b.push(brand("stratir-logo.svg", 56, 104, 30));
  b.push(t(96, 125, "STRATIR APPLIED AI STUDIO", { f: "mono-500", size: 12, fill: C.muted, tracking: 2.4 }));
  b.push(t(52, 200, "Vance Poitier", { f: "sans-700", size: 76, fill: "url(#name)", tracking: -2.6 }));
  b.push(t(56, 242, "AI & Design Engineer", { f: "sans-500", size: 22, fill: C.accent2 }));
  b.push(
    `<text x="56" y="292" font-family="${SANS}" font-weight="400" font-size="23" fill="${C.muted}">` +
      `I build agents you can ${tspan("trust", `fill="${C.text}" font-weight="500"`)} with money,</text>`,
  );
  b.push(`<text x="56" y="324" font-family="${SANS}" font-weight="400" font-size="23" fill="${C.muted}">intelligence and infrastructure.</text>`);

  // focus chips
  let x = 56;
  for (const chip of ["AGENTIC SYSTEMS", "MCP & TOOL SAFETY", "OSINT", "PAYMENTS"]) {
    const [m, w] = pill(x, 358, chip, { size: 11, tracking: 1.4, fill: C.soft });
    b.push(m);
    x += w + 8;
  }
  b.push(t(56, 424, "agents act  →  policy decides  →  people sign  →  every move proved", { f: "mono-400", size: 13, fill: C.dim }));

  // console
  const cx = 742, cy = 104, cw = 482, ch = 312;
  b.push(`<rect x="${cx + 6}" y="${cy + 14}" width="${cw}" height="${ch}" rx="16" fill="#000" opacity="0.35"/>`);
  b.push(`<rect x="${cx + 0.5}" y="${cy + 0.5}" width="${cw - 1}" height="${ch - 1}" rx="16" fill="#0b0f16" stroke="${C.line2}"/>`);
  b.push(`<path d="M${cx + 16} ${cy + 0.5}h${cw - 32}a15.5 15.5 0 0 1 15.5 15.5v24h-${cw - 1}v-24a15.5 15.5 0 0 1 15.5 -15.5z" fill="#111722"/>`);
  b.push(`<rect x="${cx}" y="${cy + 40}" width="${cw}" height="1" fill="${C.line}"/>`);
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => b.push(`<circle cx="${cx + 22 + i * 18}" cy="${cy + 20}" r="5.5" fill="${c}" opacity="0.85"/>`));
  b.push(t(cx + cw / 2, cy + 25, "vance@stratir — agents", { f: "mono-400", size: 12, fill: C.dim, anchor: "middle" }));

  const rows = [
    ["tessera", "payments", "policy-gated"],
    ["argus", "osint", "autonomous"],
    ["veronica", "screening", "gemini"],
    ["meridian", "decisions", "3 agents"],
  ];
  const lx = cx + 22;
  let ly = cy + 72;
  const lines = [];
  lines.push(`<text x="${lx}" y="${ly}" font-family="${MONO}" font-size="13.5" font-weight="400" fill="${C.text}">${tspan("$", `fill="${C.accent2}"`)} ship --agents --policy strict</text>`);
  ly += 26;
  lines.push(t(lx, ly, "› resolving 4 agents · 15 tools · 1 ledger", { f: "mono-400", size: 13, fill: C.dim }));
  for (const [name, domain, mode] of rows) {
    ly += 28;
    lines.push(
      `<g><circle cx="${lx + 4}" cy="${ly - 4.5}" r="3.5" fill="${C.green}"/>` +
        t(lx + 18, ly, name, { f: "mono-500", size: 13.5, fill: C.text }) +
        t(lx + 132, ly, domain, { f: "mono-400", size: 13.5, fill: C.muted }) +
        t(lx + 254, ly, mode, { f: "mono-400", size: 13.5, fill: C.accent2 }) +
        t(cx + cw - 22, ly, "ready", { f: "mono-400", size: 12.5, fill: C.green, anchor: "end" }) +
        `</g>`,
    );
  }
  ly += 22;
  lines.push(`<rect x="${lx}" y="${ly - 6}" width="${cw - 44}" height="1" fill="${C.line2}"/>`);
  ly += 18;
  lines.push(`<text x="${lx}" y="${ly}" font-family="${MONO}" font-size="13.5" font-weight="500" fill="${C.green}">✓ ${tspan("4 live · 0 paid twice · every move proved", `fill="${C.text}"`)}</text>`);
  ly += 30;
  lines.push(`<g><text x="${lx}" y="${ly}" font-family="${MONO}" font-size="13.5" fill="${C.accent2}">$</text><rect class="cur" x="${lx + 14}" y="${ly - 12}" width="8" height="15" fill="${C.text}"/></g>`);
  lines.forEach((l, i) => b.push(`<g class="ln" style="animation-delay:${(0.35 + i * 0.45).toFixed(2)}s">${l}</g>`));

  return svg(W, H, b.join("\n"), { fonts, css, title: "Vance Poitier, AI & Design Engineer at Stratir Applied AI Studio. I build agents you can trust with money, intelligence and infrastructure." });
}

// ---------------------------------------------------------------- section header
function header(num, title, note) {
  const H = 64;
  const b = [];
  b.push(t(2, 38, num, { f: "mono-500", size: 13, fill: C.accent2, tracking: 2.4 }));
  b.push(t(40, 38, title, { f: "mono-500", size: 13, fill: C.text, tracking: 2.4 }));
  const start = 40 + measure(title, "mono-500", 13, 2.4) + 20;
  const end = note ? W - 2 - measure(note, "mono-400", 12, 1.2) - 20 : W - 2;
  b.push(`<rect x="${start}" y="33.5" width="${end - start}" height="1" fill="${C.line2}"/>`);
  if (note) b.push(t(W - 2, 38, note, { f: "mono-400", size: 12, fill: C.dim, tracking: 1.2, anchor: "end" }));
  return svg(W, H, b.join(""), { fonts: ["mono-500", "mono-400"], title: `${num} ${title}` });
}

// ---------------------------------------------------------------- stats
function stats(d) {
  const H = 214, gap = 16, n = 5;
  const tw = (W - gap * (n - 1)) / n;
  const fonts = ["sans-600", "sans-400", "mono-500", "mono-400"];
  const css = `.draw{stroke-dasharray:600;stroke-dashoffset:600;animation:dr 2.4s ease-out .3s forwards}@keyframes dr{to{stroke-dashoffset:0}}
    .grow{transform-box:fill-box;transform-origin:left;animation:gw 1.6s cubic-bezier(.2,.7,.2,1) .2s both}@keyframes gw{from{transform:scaleX(0)}}`;
  const b = [];
  const tile = (i, kicker, value, sub, deco) => {
    const x = i * (tw + gap);
    b.push(card(x, 0, tw, H, 18));
    b.push(t(x + 22, 36, kicker, { f: "mono-500", size: 11, fill: C.dim, tracking: 2 }));
    b.push(t(x + 20, 96, value, { f: "sans-600", size: 46, fill: C.text, tracking: -1.5 }));
    b.push(t(x + 22, 124, sub, { f: "sans-400", size: 13.5, fill: C.muted }));
    b.push(deco(x));
  };
  // 1. stars, as a bar split by repository
  tile(0, "STARS EARNED", d.stars.toLocaleString("en-US"), "across public projects", (x) => {
    const top = Object.entries(d.repos).sort((a, b) => b[1].stars - a[1].stars).slice(0, 4);
    const rest = d.stars - top.reduce((s, [, r]) => s + r.stars, 0);
    const parts = [...top.map(([, r]) => r.stars), rest];
    const shades = [C.accent, "#5f95ff", "#8db3ff", "#b9cdfc", C.track];
    const bw = tw - 44;
    let px = x + 22;
    const out = [];
    parts.forEach((v, j) => {
      const w = Math.max(3, (v / d.stars) * bw - 3);
      out.push(`<rect class="grow" style="animation-delay:${0.2 + j * 0.12}s" x="${px}" y="152" width="${w}" height="10" rx="3" fill="${shades[j]}"/>`);
      px += w + 3;
    });
    out.push(t(x + 22, 186, `${top[0][0]} leads · ★ ${top[0][1].stars}`, { f: "mono-400", size: 11.5, fill: C.dim }));
    return out.join("");
  });
  // 2. contributions, as a weekly sparkline
  tile(1, "CONTRIBUTIONS", d.contributions.toLocaleString("en-US"), "in the last 12 months", (x) => {
    const weeks = [];
    for (let i = 0; i < d.days.length; i += 7) weeks.push(d.days.slice(i, i + 7).reduce((s, [, c]) => s + c, 0));
    const max = Math.max(1, ...weeks);
    const bw = tw - 44, top = 146, bottom = 192;
    const pts = weeks.map((v, j) => [x + 22 + (j / (weeks.length - 1)) * bw, bottom - (v / max) * (bottom - top)]);
    const line = pts.map(([px, py], j) => `${j ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join("");
    const area = `${line}L${x + 22 + bw} ${bottom}L${x + 22} ${bottom}Z`;
    const [lx, lyy] = pts[pts.length - 1];
    return `<path d="${area}" fill="url(#accentFade)" opacity="0.7"/><path class="draw" d="${line}" fill="none" stroke="${C.accent2}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${lx}" cy="${lyy}" r="3" fill="${C.accent2}"/>`;
  });
  // 3. public projects, one dot per repository in its language colour
  tile(2, "PUBLIC PROJECTS", String(d.publicRepos), "open source, forks excluded", (x) => {
    const out = [];
    const perRow = 26, step = (tw - 44) / perRow;
    d.repoLanguages.slice(0, 78).forEach((c, j) => {
      const r = Math.floor(j / perRow), col = j % perRow;
      out.push(`<circle cx="${x + 22 + col * step + step / 2 - 3}" cy="${158 + r * 12}" r="3.4" fill="${c ?? C.track}" opacity="0.9"/>`);
    });
    return out.join("");
  });
  // 4. hackathon builds, with the sponsors' marks
  tile(3, "HACKATHON BUILDS", "3", "agent products, shipped in days", (x) => {
    const marks = ["airwallex", "visa", "nvidia", "stripe", "mistral", "elevenlabs"];
    return marks.map((m, j) => icon(m, x + 22 + j * 34, 160, 22, C.soft, 0.85)).join("");
  });
  // 5. tenure, as a timeline
  tile(4, "BUILDING SINCE", String(d.since), `${new Date().getUTCFullYear() - d.since}+ years on GitHub`, (x) => {
    const years = [];
    for (let y = d.since; y <= new Date().getUTCFullYear(); y++) years.push(y);
    const bw = tw - 44;
    const out = [`<rect x="${x + 22}" y="165" width="${bw}" height="2" rx="1" fill="${C.line2}"/>`, `<rect class="grow" x="${x + 22}" y="165" width="${bw}" height="2" rx="1" fill="${C.accent}"/>`];
    years.forEach((y, j) => {
      const px = x + 22 + (j / (years.length - 1)) * bw;
      const last = j === years.length - 1;
      out.push(`<circle cx="${px}" cy="166" r="${last ? 5 : 3.5}" fill="${last ? C.accent2 : C.panel}" stroke="${C.accent2}" stroke-width="1.5"/>`);
      out.push(t(px, 190, `’${String(y).slice(2)}`, { f: "mono-400", size: 11, fill: last ? C.soft : C.dim, anchor: "middle" }));
    });
    return out.join("");
  });
  return svg(W, H, b.join("\n"), { fonts, css, title: `${d.stars} stars, ${d.contributions} contributions in the last year, ${d.publicRepos} public projects, 3 hackathon builds, on GitHub since ${d.since}.` });
}

// ---------------------------------------------------------------- the operating loop
function loop() {
  const H = 270;
  const fonts = ["sans-600", "sans-400", "mono-500", "mono-400"];
  const steps = [
    ["01", "The model reads", ["Models read the world and propose.", "They never hold the keys."]],
    ["02", "Policy decides", ["Rules live in code, not the prompt.", "No model can argue past them."]],
    ["03", "A person signs", ["Anything irreversible waits for", "a human signature."]],
    ["04", "The ledger proves", ["Every call, refusal and payment", "is hash-chained and verifiable."]],
  ];
  const css = `.flow{stroke-dasharray:4 8;animation:fl 1.2s linear infinite}@keyframes fl{to{stroke-dashoffset:-12}}
    .node{animation:nd 6s ease-in-out infinite}@keyframes nd{0%,100%{stroke:${C.line2}}10%,30%{stroke:${C.accent}}}`;
  const b = [card(0, 0, W, H, 20)];
  b.push(`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="19" fill="url(#dots)" opacity="0.6"/>`);
  b.push(t(32, 44, "HOW I BUILD AGENTS", { f: "mono-500", size: 12, fill: C.text, tracking: 2.4 }));
  b.push(t(W - 32, 44, "AGENTS ACT · POLICY DECIDES · PEOPLE SIGN · EVERYTHING IS PROVED", { f: "mono-400", size: 11.5, fill: C.dim, tracking: 1.6, anchor: "end" }));
  const colW = (W - 64) / 4;
  const xs = steps.map((_, i) => 32 + i * colW + 34);
  const ny = 112;
  b.push(`<line x1="${xs[0]}" y1="${ny}" x2="${xs[3]}" y2="${ny}" stroke="${C.accent}" stroke-opacity="0.55" stroke-width="1.5" class="flow"/>`);
  b.push(`<circle r="5" cy="${ny}" fill="${C.accent2}"><animate attributeName="cx" values="${xs[0]};${xs[3]}" dur="6s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1"/><animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.92;1" dur="6s" repeatCount="indefinite"/></circle>`);
  steps.forEach(([n, title, desc], i) => {
    const x = xs[i];
    b.push(`<circle cx="${x}" cy="${ny}" r="30" fill="${C.nodeFill}" stroke="${C.line2}" stroke-width="1.5" class="node" style="animation-delay:${i * 1.5}s"/>`);
    b.push(t(x, ny + 5, n, { f: "mono-500", size: 14, fill: C.accent2, anchor: "middle", tracking: 1 }));
    b.push(t(x - 34, 184, title, { f: "sans-600", size: 19, fill: C.text }));
    desc.forEach((line, j) => b.push(t(x - 34, 212 + j * 22, line, { f: "sans-400", size: 14.5, fill: C.muted })));
  });
  return svg(W, H, b.join("\n"), { fonts, css, title: "How I build agents: the model reads, policy decides, a person signs, the ledger proves." });
}

// ---------------------------------------------------------------- project cards
function project(p, d) {
  const w = 628, H = 252;
  const fonts = ["sans-600", "sans-400", "mono-500", "mono-400"];
  const r = d.repos[p.repo] ?? { stars: 0, forks: 0, language: null };
  const b = [card(0, 0, w, H, 18)];
  // The mark sits on a dark app-icon tile in both themes, so white marks stay legible.
  b.push(`<rect x="24" y="24" width="52" height="52" rx="14" fill="#0b0f16" stroke="${C.line2}"/>`);
  if (p.mark.brand) b.push(brand(p.mark.brand, 32, 32, 36));
  else b.push(icon(p.mark.icon, 36, 36, 28, "#eef2f8"));
  b.push(t(94, 50, p.title, { f: "sans-600", size: 23, fill: C.text, tracking: -0.4 }));
  b.push(t(95, 72, p.kicker, { f: "mono-400", size: 11, fill: C.dim, tracking: 1.4 }));
  // badge, top right
  const bw = measure(p.badge.text, "mono-500", 10.5, 1.4) + 22;
  b.push(`<rect x="${w - 24 - bw}" y="26" width="${bw}" height="22" rx="11" fill="${p.badge.color}" fill-opacity="0.1" stroke="${p.badge.color}" stroke-opacity="0.35"/>`);
  b.push(t(w - 24 - bw / 2, 41, p.badge.text, { f: "mono-500", size: 10.5, fill: p.badge.color, tracking: 1.4, anchor: "middle" }));
  // description
  wrap(p.desc, "sans-400", 15.5, w - 52).slice(0, 3).forEach((line, i) => b.push(t(26, 114 + i * 24, line, { f: "sans-400", size: 15.5, fill: C.soft })));
  // footer
  b.push(`<rect x="24" y="${H - 58}" width="${w - 48}" height="1" fill="${C.line}"/>`);
  let x = 26;
  const fy = H - 26;
  if (r.language) {
    b.push(`<circle cx="${x + 5}" cy="${fy - 4.5}" r="5" fill="${r.language.color}"/>`);
    b.push(t(x + 16, fy, r.language.name, { f: "sans-400", size: 13.5, fill: C.muted }));
    x += 16 + measure(r.language.name, "sans-400", 13.5) + 20;
  }
  if (r.stars > 0) {
    b.push(`<path transform="translate(${x} ${fy - 12}) scale(0.62)" d="M10 1.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L10 15.2l-5.4 2.9 1-6.1L1.2 7.7l6.1-.9z" fill="${C.amber}"/>`);
    b.push(t(x + 18, fy, String(r.stars), { f: "sans-400", size: 13.5, fill: C.muted }));
    x += 18 + measure(String(r.stars), "sans-400", 13.5) + 18;
  }
  if (r.forks > 0) {
    b.push(`<g transform="translate(${x} ${fy - 12})" fill="none" stroke="${C.muted}" stroke-width="1.4" stroke-linecap="round"><circle cx="3" cy="2.5" r="2"/><circle cx="11" cy="2.5" r="2"/><circle cx="7" cy="12" r="2"/><path d="M3 4.5v1.5a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V4.5M7 8v2"/></g>`);
    b.push(t(x + 20, fy, String(r.forks), { f: "sans-400", size: 13.5, fill: C.muted }));
    x += 20 + measure(String(r.forks), "sans-400", 13.5) + 18;
  }
  // tags, right aligned
  let tx = w - 24;
  for (const tag of [...p.tags].reverse()) {
    const tw = measure(tag, "mono-400", 11, 0.6) + 20;
    tx -= tw;
    if (tx < x + 60) break;
    b.push(`<rect x="${tx}" y="${fy - 17}" width="${tw}" height="24" rx="7" fill="${C.chip}" stroke="${C.line}"/>`);
    b.push(t(tx + tw / 2, fy - 1, tag, { f: "mono-400", size: 11, fill: C.soft, tracking: 0.6, anchor: "middle" }));
    tx -= 8;
  }
  return svg(w, H, b.join("\n"), { fonts, title: `${p.title}: ${p.desc} ${r.stars} stars.` });
}

// ---------------------------------------------------------------- activity: heatmap and languages
function activity(d) {
  const H = 262;
  const fonts = ["sans-600", "sans-400", "mono-500", "mono-400"];
  const css = `.cell{animation:cf .5s ease-out both}@keyframes cf{from{opacity:0}}`;
  const b = [];
  // heatmap card
  const hw = 868;
  b.push(card(0, 0, hw, H, 18));
  b.push(t(26, 40, "CONTRIBUTION GRAPH", { f: "mono-500", size: 11, fill: C.dim, tracking: 2 }));
  b.push(t(hw - 26, 40, `${d.contributions.toLocaleString("en-US")} in the last year`, { f: "mono-400", size: 12, fill: C.soft, anchor: "end" }));
  const days = d.days;
  const first = new Date(days[0][0] + "T00:00:00Z").getUTCDay();
  const max = Math.max(1, ...days.map(([, c]) => c));
  const levels = C.heat;
  const level = (c) => (c === 0 ? 0 : c <= max * 0.15 ? 1 : c <= max * 0.35 ? 2 : c <= max * 0.65 ? 3 : 4);
  const cs = 12, gap = 3.2, ox = 54, oy = 72;
  let lastMonth = -1;
  days.forEach(([date, c], i) => {
    const idx = i + first;
    const col = Math.floor(idx / 7), row = idx % 7;
    const x = ox + col * (cs + gap), y = oy + row * (cs + gap);
    b.push(`<rect class="cell" style="animation-delay:${(col * 0.012).toFixed(3)}s" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cs}" height="${cs}" rx="2.6" fill="${levels[level(c)]}"/>`);
    const m = new Date(date + "T00:00:00Z").getUTCMonth();
    if (row === 0 && m !== lastMonth) {
      if (col > 0 || first === 0) b.push(t(x, oy - 10, new Date(date + "T00:00:00Z").toLocaleString("en-US", { month: "short", timeZone: "UTC" }), { f: "mono-400", size: 10.5, fill: C.dim }));
      lastMonth = m;
    }
  });
  ["Mon", "Wed", "Fri"].forEach((l, i) => b.push(t(26, oy + (1 + i * 2) * (cs + gap) + 10, l, { f: "mono-400", size: 10.5, fill: C.dim })));
  const ly = oy + 7 * (cs + gap) + 30;
  b.push(t(26, ly, "Less", { f: "mono-400", size: 10.5, fill: C.dim }));
  levels.forEach((c, i) => b.push(`<rect x="${62 + i * 16}" y="${ly - 10}" width="12" height="12" rx="2.6" fill="${c}"/>`));
  b.push(t(62 + 5 * 16 + 4, ly, "More", { f: "mono-400", size: 10.5, fill: C.dim }));
  // busiest week, from the data
  let best = [0, 0];
  for (let i = 0; i < days.length; i += 7) {
    const s = days.slice(i, i + 7).reduce((a, [, c]) => a + c, 0);
    if (s > best[0]) best = [s, i];
  }
  const bestDate = new Date(days[best[1]][0] + "T00:00:00Z").toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  b.push(t(hw - 26, ly, `busiest week · ${best[0]} contributions from ${bestDate}`, { f: "mono-400", size: 11, fill: C.dim, anchor: "end" }));

  // languages card
  const lx = hw + 16, lw = W - lx;
  b.push(card(lx, 0, lw, H, 18));
  b.push(t(lx + 24, 40, "LANGUAGES · BY PROJECT", { f: "mono-500", size: 11, fill: C.dim, tracking: 2 }));
  const langs = d.languages.slice(0, 6);
  const total = d.languages.reduce((s, l) => s + l.repos, 0);
  const bw = lw - 48;
  let bx = lx + 24;
  langs.forEach((l) => {
    const w = (l.repos / total) * bw;
    b.push(`<rect x="${bx}" y="60" width="${Math.max(2, w - 2)}" height="8" rx="2" fill="${l.color}"/>`);
    bx += w;
  });
  langs.forEach((l, i) => {
    const y = 102 + i * 25;
    b.push(`<circle cx="${lx + 29}" cy="${y - 4.5}" r="4.5" fill="${l.color}"/>`);
    b.push(t(lx + 42, y, l.name, { f: "sans-400", size: 14, fill: C.soft }));
    b.push(t(lx + lw - 24, y, `${Math.round((l.repos / total) * 100)}%`, { f: "mono-400", size: 12.5, fill: C.dim, anchor: "end" }));
  });
  return svg(W, H, b.join("\n"), { fonts, css, title: `Contribution graph: ${d.contributions} contributions in the last year. Languages by project: ${langs.map((l) => l.name).join(", ")}.` });
}

// ---------------------------------------------------------------- ecosystem wall
function stack() {
  const cols = 8, tileW = (W - 7 * 10) / cols, tileH = 104, rowGap = 50;
  const H = 30 + STACK.length * (tileH + rowGap) - 18;
  const fonts = ["sans-400", "mono-500"];
  const css = `.tile{animation:tf .6s ease-out both}@keyframes tf{from{opacity:0;transform:translateY(6px)}}
    .lg{transition:none}`;
  const b = [];
  STACK.forEach((row, ri) => {
    const y0 = ri * (tileH + rowGap);
    b.push(t(2, y0 + 14, row.label, { f: "mono-500", size: 11, fill: C.dim, tracking: 2 }));
    row.items.forEach(([name, label, scale = 1], ci) => {
      const x = ci * (tileW + 10), y = y0 + 28;
      const inner = [
        `<rect x="${x + 0.5}" y="${y + 0.5}" width="${tileW - 1}" height="${tileH - 1}" rx="14" fill="url(#panel)" stroke="${C.line}"/>`,
        icon(name, x + tileW / 2 - (34 * scale) / 2, y + 20 - (34 * scale - 34) / 2, 34 * scale, C.text, 0.92),
        t(x + tileW / 2, y + tileH - 18, label, { f: "sans-400", size: label.length > 18 ? 11 : 12.5, fill: C.muted, anchor: "middle" }),
      ].join("");
      b.push(`<g class="tile" style="animation-delay:${(ri * 0.25 + ci * 0.05).toFixed(2)}s">${inner}</g>`);
    });
  });
  return svg(W, H, b.join("\n"), { fonts, css, title: `The agentic ecosystem I build across: ${STACK.flatMap((r) => r.items.map((i) => i[1])).join(", ")}.` });
}

// ---------------------------------------------------------------- connect buttons
function button(kind, label) {
  const f = "sans-500", size = 14.5;
  const w = Math.round(measure(label, f, size) + 66), H = 44;
  const b = [`<rect x="0.5" y="0.5" width="${w - 1}" height="${H - 1}" rx="12" fill="url(#panel)" stroke="${C.line2}"/>`];
  if (kind === "linkedin")
    b.push(`<rect x="18" y="13" width="18" height="18" rx="4" fill="${C.text}"/>` + t(27, 27.5, "in", { f: "sans-600", size: 12.5, fill: C.bg, anchor: "middle" }));
  else if (kind === "web")
    b.push(`<g transform="translate(18 13)" fill="none" stroke="${C.text}" stroke-width="1.5"><circle cx="9" cy="9" r="8"/><path d="M1 9h16M9 1c2.6 2.4 2.6 13.6 0 16M9 1c-2.6 2.4-2.6 13.6 0 16"/></g>`);
  else b.push(icon(kind, 18, 13, 18, C.text));
  b.push(t(46, 27.5, label, { f, size, fill: C.text }));
  return svg(w, H, b.join(""), { fonts: [f, ...(kind === "linkedin" ? ["sans-600"] : [])], title: label });
}

// ---------------------------------------------------------------- footer
function footer(d) {
  const H = 120;
  const b = [`<rect x="0" y="0" width="${W}" height="1" fill="url(#rule)"/>`];
  b.push(t(W / 2, 58, "Just ship it.", { f: "sans-600", size: 28, fill: C.text, anchor: "middle", tracking: -0.6 }));
  b.push(t(W / 2, 90, `REFRESHED DAILY FROM THE GITHUB API · ${d.stars} ★ · ${d.contributions} CONTRIBUTIONS`, { f: "mono-400", size: 11, fill: C.dim, anchor: "middle", tracking: 1.6 }));
  return svg(W, H, b.join(""), { fonts: ["sans-600", "mono-400"], title: "Just ship it." });
}

// ---------------------------------------------------------------- main
const offline = process.argv.includes("--offline");
const snapshot = A("data.json");
const data = offline && existsSync(snapshot) ? JSON.parse(readFileSync(snapshot, "utf8")) : await fetchData();
if (!offline) writeFileSync(snapshot, JSON.stringify(data, null, 0) + "\n");

const out = {};
C = DARK;
out["hero.svg"] = hero(data); // the banner is dark in both themes
for (const theme of [DARK, LIGHT]) {
  C = theme;
  const themed = {
  "stats.svg": stats(data),
  "loop.svg": loop(),
  "activity.svg": activity(data),
  "stack.svg": stack(),
  "footer.svg": footer(data),
  "section-principles.svg": header("01", "OPERATING PRINCIPLE", "AGENTS YOU CAN TRUST"),
  "section-work.svg": header("02", "SELECTED WORK", "STAR COUNTS REFRESH DAILY"),
  "section-signal.svg": header("03", "SIGNAL", "LIVE FROM THE GITHUB API"),
  "section-stack.svg": header("04", "THE AGENTIC ECOSYSTEM", "MODELS · FRAMEWORKS · RAILS"),
  "btn-web.svg": button("web", "vancepoitier.me"),
  "btn-x.svg": button("x", "@vancepoitier"),
  "btn-linkedin.svg": button("linkedin", "LinkedIn"),
  "btn-email.svg": button("protonmail", "vvp15@pm.me"),
  };
  for (const p of FEATURED) themed[`projects/${p.repo}.svg`] = project(p, data);
  for (const [file, content] of Object.entries(themed)) out[`${theme.name}/${file}`] = content;
}

for (const file of Object.keys(out)) mkdirSync(dirname(A(file)), { recursive: true });
for (const [file, content] of Object.entries(out)) writeFileSync(A(file), content);
console.log(`wrote ${Object.keys(out).length} images · ${data.stars} stars · ${data.contributions} contributions · ${data.publicRepos} public projects`);
