#!/usr/bin/env node
// Renders the profile's cards from live GitHub data. No third-party card services and no dependencies.
//   node scripts/build.mjs             (GITHUB_TOKEN or PROFILE_TOKEN; locally the gh CLI login)
//   node scripts/build.mjs --offline   (re-render from the snapshot in assets/data.json)
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const A = (...p) => join(ROOT, "assets", ...p);
const LOGIN = "AXRoux";

// ================================================================ type
const METRICS = JSON.parse(readFileSync(A("fonts", "metrics.json"), "utf8"));
const FAMILY = { sans: "GS", sansi: "GSI", mono: "GM" };
const STACK = {
  sans: "GS,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
  sansi: "GSI,-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif",
  mono: "GM,ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
};
const fontFace = (key) => {
  const [family, weight] = key.split("-");
  const data = readFileSync(A("fonts", `${key}.woff2`)).toString("base64");
  return `@font-face{font-family:${FAMILY[family]};font-weight:${weight};${family === "sansi" ? "font-style:italic;" : ""}src:url(data:font/woff2;base64,${data}) format("woff2")}`;
};
function measure(text, key, size, tracking = 0) {
  const m = METRICS[key];
  let w = 0;
  for (const ch of String(text)) w += m.w[ch] ?? m.default;
  return w * size + tracking * Math.max(0, [...String(text)].length - 1);
}
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
/** Text. f is "<family>-<weight>", e.g. "sans-700", "sansi-400", "mono-500". */
function t(x, y, text, { f = "sans-400", size = 14, fill = INK, anchor, tracking, opacity } = {}) {
  const [family, weight] = f.split("-");
  return `<text x="${r2(x)}" y="${r2(y)}" font-family="${STACK[family]}" font-weight="${weight}"${family === "sansi" ? ' font-style="italic"' : ""} font-size="${size}" fill="${fill}"${anchor ? ` text-anchor="${anchor}"` : ""}${tracking ? ` letter-spacing="${tracking}"` : ""}${opacity !== undefined ? ` opacity="${opacity}"` : ""}>${esc(text)}</text>`;
}
const r2 = (n) => Math.round(n * 100) / 100;

// ================================================================ colour
const INK = "#141824";
const INK2 = "#3b4254";
const INK3 = "#6b7385";
/** Mix two hex colours: a share of b. */
function mix(a, b, share) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * share).toString(16).padStart(2, "0")).join("");
}

// ================================================================ images
const dataUri = (file, mime) => `data:${mime};base64,${readFileSync(file).toString("base64")}`;
/** A full-colour company logo, isolated as an image so its gradients cannot collide with the card's. */
function logo(name, x, y, size) {
  const src = readFileSync(A("logos", `${name}.svg`), "utf8");
  const [, , vw, vh] = src.match(/viewBox="([^"]+)"/)[1].split(/\s+/).map(Number);
  const w = vw >= vh ? size : (size * vw) / vh;
  const h = vw >= vh ? (size * vh) / vw : size;
  return `<image x="${r2(x + (size - w) / 2)}" y="${r2(y + (size - h) / 2)}" width="${r2(w)}" height="${r2(h)}" href="${dataUri(A("logos", `${name}.svg`), "image/svg+xml")}"/>`;
}

// ================================================================ document
let uid = 0;
const id = (p) => `${p}${++uid}`;
function svg(w, h, body, { fonts, title }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<style>${[...new Set(fonts)].map(fontFace).join("")}</style>
${body}
</svg>`;
}

// ================================================================ illustration kit (sticker style: ink outline, hard shadow)
const SH = 5; // hard shadow offset
function sticker(x, y, w, h, r, fill, { stroke = INK, sw = 2.5, shadow = INK, sh = SH } = {}) {
  return (
    (shadow ? `<rect x="${r2(x + sh)}" y="${r2(y + sh)}" width="${r2(w)}" height="${r2(h)}" rx="${r}" fill="${shadow}"/>` : "") +
    `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
  );
}
function disc(cx, cy, r, fill, { shadow = INK, sh = 4, sw = 2.5 } = {}) {
  return (shadow ? `<circle cx="${cx + sh}" cy="${cy + sh}" r="${r}" fill="${shadow}"/>` : "") + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${INK}" stroke-width="${sw}"/>`;
}
/** A white chip with an optional leading dot or logo, mono label. Returns markup. */
function chip(x, y, label, { dot, logoName, fill = "#ffffff", color = INK, size = 15, h = 34 } = {}) {
  const lead = dot || logoName ? 22 : 0;
  const w = measure(label, "mono-600", size) + 26 + lead;
  let m = sticker(x, y, w, h, h / 2, fill, { sh: 4 });
  if (dot) m += `<circle cx="${x + 19}" cy="${y + h / 2}" r="5.5" fill="${dot}" stroke="${INK}" stroke-width="1.8"/>`;
  if (logoName) m += logo(logoName, x + 10, y + h / 2 - 9, 18);
  m += t(x + 13 + lead, y + h / 2 + size * 0.35, label, { f: "mono-600", size, fill: color });
  return m;
}

// ================================================================ the artwork
// Holographic plates generated with fal.ai (Flux Pro 1.1 Ultra; the profile card is the real photo, cut out with
// BiRefNet onto a foil plate), stored in assets/art at 1032 x 576. One sticker chip per card carries a fact.
const AW = 430, AH = 240;
const artImage = (name) => `<image width="${AW}" height="${AH}" preserveAspectRatio="xMidYMid slice" href="${dataUri(A("art", `${name}.webp`), "image/webp")}"/>`;
const ART = {
  vance: () => artImage("vance") + chip(16, 16, "just ship it", { dot: "#22c55e", size: 14, h: 30 }),
  tessera: () => artImage("tessera") + chip(16, 16, "57/57 attacks held", { dot: "#22c55e", size: 13.5, h: 30 }),
  osint: () => artImage("osint") + chip(16, 16, "entities → report.json", { dot: "#06b6d4", size: 13.5, h: 30 }),
  argus: () => artImage("argus") + chip(16, 16, "6 adapters · 5 rounds", { dot: "#f97316", size: 13.5, h: 30 }),
  veronica: () => artImage("veronica") + chip(16, 16, "sanctions · watchlists", { dot: "#dc2626", size: 13.5, h: 30 }),
  meridian: () => artImage("meridian") + chip(16, 16, "for · against · verdict", { dot: "#f59e0b", size: 13.5, h: 30 }),
  signal: () => artImage("signal") + chip(16, 16, "encrypted on disk", { dot: "#a855f7", size: 13.5, h: 30 }),
};

// ================================================================ the card
const CW = 500, CH = 700;
const PALETTE_KEYS = ["sans-900", "sans-700", "sans-400", "sansi-400", "sansi-500", "mono-500", "mono-600"];

function card(spec, n, total) {
  const ids = { frame: id("fr"), dots: id("dt"), panel: id("pn"), art: id("ar"), artBg: id("ab"), cardFace: id("cf"), holo: id("ho"), sheen: id("sh"), strip: id("st") };
  const c = { ...spec, ids };
  const [f1, f2] = spec.frame;
  const holo = !!spec.holo;
  const b = [];
  b.push(`<defs>
    <linearGradient id="${ids.frame}" x1="0" y1="0" x2="1" y2="1">${holo
      ? `<stop offset="0" stop-color="#ffd1e8"/><stop offset="0.25" stop-color="#d4e4ff"/><stop offset="0.5" stop-color="#c9f5e1"/><stop offset="0.75" stop-color="#fff0bf"/><stop offset="1" stop-color="#e5d4ff"/>`
      : `<stop offset="0" stop-color="${f1}"/><stop offset="1" stop-color="${f2}"/>`}</linearGradient>
    <linearGradient id="${ids.holo}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ac6"/><stop offset="0.33" stop-color="#7cc4ff"/><stop offset="0.66" stop-color="#7dffc4"/><stop offset="1" stop-color="#ffe27a"/></linearGradient>
    <linearGradient id="${ids.panel}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(spec.tint, "#ffffff", 0.2)}"/><stop offset="1" stop-color="${spec.tint}"/></linearGradient>
    <linearGradient id="${ids.artBg}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${mix(f1, "#ffffff", 0.55)}"/><stop offset="1" stop-color="${mix(f2, "#ffffff", 0.35)}"/></linearGradient>
    <linearGradient id="${ids.cardFace}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b6cff"/><stop offset="0.55" stop-color="#5b4dff"/><stop offset="1" stop-color="#8a5cff"/></linearGradient>
    <linearGradient id="${ids.sheen}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#ffffff" stop-opacity="0"/><stop offset="0.65" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.25"/></linearGradient>
    <linearGradient id="${ids.strip}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${mix(f1, "#ffffff", 0.7)}"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="${mix(f2, "#ffffff", 0.7)}"/></linearGradient>
    <pattern id="${ids.dots}" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="1.05" fill="#ffffff" opacity="${holo ? 0.55 : 0.22}"/></pattern>
    <clipPath id="${ids.art}"><rect x="35" y="83" width="${AW}" height="${AH}" rx="8"/></clipPath>
  </defs>`);

  // frame and panel
  b.push(`<rect x="1" y="1" width="${CW - 2}" height="${CH - 2}" rx="26" fill="url(#${ids.frame})"/>`);
  b.push(`<rect x="1" y="1" width="${CW - 2}" height="${CH - 2}" rx="26" fill="url(#${ids.dots})"/>`);
  b.push(`<rect x="1" y="1" width="${CW - 2}" height="${CH - 2}" rx="26" fill="url(#${ids.sheen})"/>`);
  if (!holo) b.push(`<rect x="1" y="1" width="${CW - 2}" height="${CH - 2}" rx="26" fill="url(#${ids.holo})" opacity="0.22"/>`);
  b.push(`<rect x="1" y="1" width="${CW - 2}" height="${CH - 2}" rx="26" fill="none" stroke="${holo ? "#b9a6e8" : mix(f2, INK, 0.35)}" stroke-width="2"/>`);
  b.push(`<rect x="14" y="14" width="${CW - 28}" height="${CH - 28}" rx="16" fill="url(#${ids.panel})" stroke="${holo ? "#c8b8ee" : mix(f2, INK, 0.2)}" stroke-width="1.5"/>`);
  b.push(`<rect x="17" y="17" width="${CW - 34}" height="${CH - 34}" rx="14" fill="none" stroke="#ffffff" stroke-opacity="0.8" stroke-width="1.2"/>`);

  // header: name, number, type badge
  b.push(t(32, 58, spec.name, { f: "sans-900", size: spec.name.length > 13 ? 29 : 33, fill: INK, tracking: -0.8 }));
  b.push(disc(448, 46, 21, "#ffffff", { shadow: null, sw: 2 }) + logo(spec.type, 435, 33, 26));
  if (spec.hp) {
    const num = String(spec.hp.value);
    const nw = measure(num, "sans-900", 30, -0.5);
    b.push(t(414, 57, num, { f: "sans-900", size: 30, anchor: "end", tracking: -0.5 }));
    b.push(t(414 - nw - 5, 57, spec.hp.label, { f: "sans-700", size: 13, fill: INK2, anchor: "end" }));
  }

  // art window
  b.push(`<rect x="27" y="75" width="${AW + 16}" height="${AH + 16}" rx="13" fill="url(#${ids.holo})" stroke="${INK}" stroke-opacity="0.85" stroke-width="2"/>`);
  b.push(`<rect x="31" y="79" width="${AW + 8}" height="${AH + 8}" rx="10" fill="#ffffff" opacity="0.45"/>`);
  b.push(`<g clip-path="url(#${ids.art})"><g transform="translate(35 83)">${ART[spec.art](c)}</g></g>`);
  b.push(`<rect x="35" y="83" width="${AW}" height="${AH}" rx="8" fill="none" stroke="${INK}" stroke-width="2"/>`);

  // type strip
  b.push(`<path d="M58 334h384l-10 26H68z" fill="url(#${ids.strip})" stroke="${holo ? "#c8b8ee" : mix(f2, "#ffffff", 0.3)}" stroke-width="1.2"/>`);
  b.push(t(250, 352, spec.strip, { f: "sansi-500", size: 13.5, fill: INK2, anchor: "middle" }));

  // moves
  let y = 392;
  spec.moves.forEach((mv, i) => {
    mv.cost.forEach((name, j) => b.push(disc(48 + j * 32, y - 6, 15, "#ffffff", { shadow: null, sw: 1.6 }) + logo(name, 48 + j * 32 - 10, y - 16, 20)));
    const nameX = 48 + mv.cost.length * 32 - 6;
    b.push(t(nameX, y + 1, mv.name, { f: "sans-700", size: 21, tracking: -0.3 }));
    if (mv.value) b.push(t(466, y + 2, mv.value, { f: "sans-900", size: 25, anchor: "end", tracking: -0.5 }));
    wrap(mv.text, "sans-400", 15, 466 - 34).slice(0, 2).forEach((line, k) => b.push(t(34, y + 27 + k * 20, line, { f: "sans-400", size: 15, fill: INK2 })));
    y += 92;
    if (i === 0) b.push(`<rect x="34" y="${y - 30}" width="432" height="1.2" fill="${INK}" opacity="0.12"/>`);
  });

  // stat bar
  const sy = 562;
  b.push(`<rect x="30" y="${sy}" width="440" height="44" rx="10" fill="#ffffff" fill-opacity="0.7" stroke="${INK}" stroke-opacity="0.12"/>`);
  spec.stats.forEach(([label, value], i) => {
    const x = 30 + (440 / 3) * i + 440 / 6;
    if (i) b.push(`<rect x="${30 + (440 / 3) * i}" y="${sy + 9}" width="1" height="26" fill="${INK}" opacity="0.12"/>`);
    b.push(t(x, sy + 17, label, { f: "mono-500", size: 9.5, fill: INK3, anchor: "middle", tracking: 1.2 }));
    b.push(t(x, sy + 36, value, { f: "sans-700", size: 15, anchor: "middle" }));
  });

  // flavour text
  const fl = wrap(spec.flavor, "sansi-400", 13, 420).slice(0, 2);
  b.push(`<rect x="30" y="616" width="440" height="${fl.length > 1 ? 44 : 30}" rx="8" fill="none" stroke="${holo ? "#b9a6e8" : mix(f2, "#ffffff", 0.2)}" stroke-width="1.2"/>`);
  fl.forEach((line, k) => b.push(t(42, 634 + k * 17, line, { f: "sansi-400", size: 13, fill: INK2 })));

  // footer
  b.push(t(34, 676, `AXROUX · ${new Date().getUTCFullYear()} EDITION`, { f: "mono-500", size: 9.5, fill: INK3, tracking: 1.2 }));
  b.push(t(466, 676, `${String(n).padStart(2, "0")}/${String(total).padStart(2, "0")}  ${holo ? "★★★" : "★"}`, { f: "mono-600", size: 10, fill: INK2, anchor: "end", tracking: 1 }));

  return svg(CW, CH, b.join("\n"), { fonts: PALETTE_KEYS, title: `${spec.name}. ${spec.flavor}` });
}

// ================================================================ the ecosystem binder
const ECOSYSTEM = [
  ["Frontier labs", [["openai", "OpenAI"], ["anthropic", "Anthropic"], ["deepmind", "Google DeepMind"], ["xai", "xAI"], ["spacex", "SpaceX"], ["meta", "Meta"], ["mistral", "Mistral AI"], ["nvidia", "NVIDIA"]]],
  ["Agents & orchestration", [["langchain", "LangChain"], ["langgraph", "LangGraph"], ["mcp", "MCP"], ["crewai", "CrewAI"], ["nousresearch", "Nous Research"], ["huggingface", "Hugging Face"], ["perplexity", "Perplexity"], ["elevenlabs", "ElevenLabs"]]],
  ["Rails & infrastructure", [["aws", "AWS"], ["cloudflare", "Cloudflare"], ["vercel", "Vercel"], ["stripe", "Stripe"], ["visa", "Visa"], ["airwallex", "Airwallex"], ["cursor", "Cursor"], ["githubcopilot", "GitHub Copilot"]]],
];
function ecosystem() {
  const W = 1280, pad = 32, cols = 8, gap = 14;
  const tw = (W - pad * 2 - gap * (cols - 1)) / cols, th = 112, rowH = th + 56;
  const H = pad + ECOSYSTEM.length * rowH + 4;
  const b = [`<rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="24" fill="#ffffff" stroke="#e3e7ee" stroke-width="2"/>`];
  ECOSYSTEM.forEach(([label, items], r) => {
    const y0 = pad + r * rowH;
    b.push(t(pad + 2, y0 + 20, label, { f: "sans-700", size: 17, fill: INK }));
    b.push(t(W - pad, y0 + 20, `${String(r + 1).padStart(2, "0")}`, { f: "mono-500", size: 12, fill: "#9aa3b2", anchor: "end" }));
    items.forEach(([name, title], i) => {
      const x = pad + i * (tw + gap), y = y0 + 36;
      b.push(`<rect x="${r2(x)}" y="${y}" width="${r2(tw)}" height="${th}" rx="16" fill="#f7f8fb" stroke="#e6e9f0" stroke-width="1.5"/>`);
      const size = name === "spacex" ? 70 : 42; // SpaceX's mark is a thin swoosh: give it room to read
      b.push(logo(name, x + tw / 2 - size / 2, y + 41 - size / 2, size));
      b.push(t(x + tw / 2, y + th - 18, title, { f: "sans-500", size: title.length > 14 ? 12.5 : 14, fill: INK2, anchor: "middle" }));
    });
  });
  return svg(W, H, b.join("\n"), { fonts: ["sans-700", "sans-500", "mono-500"], title: `The agentic ecosystem I build across: ${ECOSYSTEM.flatMap(([, i]) => i.map((x) => x[1])).join(", ")}.` });
}

// ================================================================ small round icons for the header
function social(kind) {
  const S = 64;
  const bg = { x: "#0b0d12", linkedin: "#0a66c2", web: "#2f6bff", mail: "#6d4aff", github: "#181717" }[kind];
  const b = [`<rect width="${S}" height="${S}" rx="18" fill="${bg}"/>`];
  if (kind === "linkedin") b.push(t(S / 2, 44, "in", { f: "sans-900", size: 30, fill: "#ffffff", anchor: "middle", tracking: -1 }));
  else if (kind === "web") b.push(`<g transform="translate(16 16)" fill="none" stroke="#ffffff" stroke-width="2.6"><circle cx="16" cy="16" r="14"/><path d="M2 16h28M16 2c5 4 5 24 0 28M16 2c-5 4-5 24 0 28"/></g>`);
  else if (kind === "mail") b.push(`<g transform="translate(14 19)" fill="none" stroke="#ffffff" stroke-width="2.6" stroke-linejoin="round"><rect x="0" y="0" width="36" height="26" rx="4"/><path d="M2 3l16 12 16-12"/></g>`);
  else {
    const src = readFileSync(A("logos", `${kind}.svg`), "utf8").replace(/fill="#[0-9A-Fa-f]{6}"/, 'fill="#ffffff"');
    b.push(`<image x="16" y="16" width="32" height="32" href="data:image/svg+xml;base64,${Buffer.from(src).toString("base64")}"/>`);
  }
  return svg(S, S, b.join(""), { fonts: kind === "linkedin" ? ["sans-900"] : [], title: kind });
}

// ================================================================ data
const FEATURED = ["tessera", "OSINT-Assistant", "argus-os", "veronica-osint", "meridian", "signal-canvas"];
async function fetchData() {
  const token = process.env.PROFILE_TOKEN || process.env.GITHUB_TOKEN || execSync("gh auth token", { encoding: "utf8" }).trim();
  const query = `query($login:String!){ user(login:$login){
    createdAt followers{totalCount}
    repositories(ownerAffiliations:OWNER, privacy:PUBLIC, isFork:false, first:100){ totalCount nodes{ name stargazerCount forkCount primaryLanguage{name} } }
    contributionsCollection{ contributionCalendar{ totalContributions } } } }`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "axroux-profile" },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub GraphQL: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  const u = json.data.user;
  const repos = u.repositories.nodes;
  return {
    since: new Date(u.createdAt).getUTCFullYear(),
    followers: u.followers.totalCount,
    publicRepos: u.repositories.totalCount,
    stars: repos.reduce((s, r) => s + r.stargazerCount, 0),
    contributions: u.contributionsCollection.contributionCalendar.totalContributions,
    // Only the repositories the deck shows are kept in the snapshot.
    repos: Object.fromEntries(repos.filter((r) => FEATURED.includes(r.name)).map((r) => [r.name, { stars: r.stargazerCount, forks: r.forkCount, language: r.primaryLanguage?.name ?? "" }])),
  };
}

// ================================================================ the deck
function deck(d) {
  const repo = (name) => d.repos[name] ?? { stars: 0, forks: 0, language: "" };
  const starsHp = (name) => (repo(name).stars > 0 ? { label: "★", value: repo(name).stars } : null);
  return [
    {
      file: "vance", art: "vance", holo: true, name: "Vance Poitier", type: "github",
      frame: ["#ffd1e8", "#e5d4ff"], tint: "#fbf8ff",
      hp: { label: "HP", value: d.contributions },
      strip: "AI & Design Engineer · Agents, OSINT, payments",
      moves: [
        { name: "Ship It", cost: ["github", "typescript"], value: String(d.publicRepos), text: `${d.publicRepos} public projects, from investigation tools to agent payments.` },
        { name: "Hackathon", cost: ["airwallex", "mistral", "nvidia"], value: "×3", text: "Three agent products built and shipped at hackathons, each in days." },
      ],
      stats: [["STARS", String(d.stars)], ["CONTRIBUTIONS", String(d.contributions)], ["SINCE", String(d.since)]],
      flavor: "“Just ship it.” Builds agents you can trust with money, intelligence and infrastructure.",
    },
    {
      file: "tessera", art: "tessera", name: "Tessera", type: "airwallex",
      frame: ["#5b8cff", "#5a3df0"], tint: "#f3f5ff", hp: starsHp("tessera"),
      strip: "Agent payments · TypeScript · Airwallex × Visa",
      moves: [
        { name: "Policy Gate", cost: ["anthropic", "mcp"], value: "15", text: "Fifteen typed tools over MCP. Any other move is refused before money moves." },
        { name: "Red Team", cost: ["airwallex", "visa"], value: "57/57", text: "Fifty-seven attacks try to pay a supplier twice. Code holds every one." },
      ],
      stats: [["TESTS", "694"], ["MUTATIONS", "100/100"], ["LICENSE", "MIT"]],
      flavor: "Money that moves once, and can prove it. Built at the Airwallex Agentic Banking Hackathon.",
    },
    {
      file: "osint-assistant", art: "osint", name: "OSINT Assistant", type: "perplexity",
      frame: ["#2fd5c9", "#0b8fb3"], tint: "#effcfc", hp: starsHp("OSINT-Assistant"),
      strip: "Research agent · Python · Perplexity Sonar",
      moves: [
        { name: "Sonar Sweep", cost: ["perplexity"], value: "", text: "Gathers from many web sources and reads them with Perplexity Sonar." },
        { name: "Entity Graph", cost: ["python"], value: "", text: "Finds the people, organisations and concepts, then maps how they connect." },
      ],
      stats: [["STARS", String(repo("OSINT-Assistant").stars)], ["FORKS", String(repo("OSINT-Assistant").forks)], ["LANGUAGE", "Python"]],
      flavor: "One question in, a structured report out. A command line and a web app.",
    },
    {
      file: "argus", art: "argus", name: "Argus", type: "ollama",
      frame: ["#ffa24a", "#ee3f62"], tint: "#fff6f1", hp: starsHp("argus-os"),
      strip: "Autonomous OSINT · TypeScript · Self-hosted",
      moves: [
        { name: "Agent Loop", cost: ["openai", "ollama"], value: "×5", text: "Plans the investigation, runs the tools and iterates, up to five rounds a query." },
        { name: "Cross-Check", cost: ["typescript"], value: "6", text: "WHOIS, DNS, GeoIP, web search, Shodan and scraping, findings correlated." },
      ],
      stats: [["STARS", String(repo("argus-os").stars)], ["ADAPTERS", "6"], ["LICENSE", "MIT"]],
      flavor: "Ask in plain language. No manual tool selection, no copy-pasting between services.",
    },
    {
      file: "veronica", art: "veronica", name: "Veronica", type: "gemini",
      frame: ["#3fe0a0", "#0b9467"], tint: "#effcf6", hp: starsHp("veronica-osint"),
      strip: "Investigative copilot · TypeScript · Gemini",
      moves: [
        { name: "Screen", cost: ["gemini"], value: "", text: "Checks people and companies against global sanctions and watchlists." },
        { name: "Next Step", cost: ["gemini", "typescript"], value: "", text: "Reasons about what it found and suggests where to look next." },
      ],
      stats: [["STARS", String(repo("veronica-osint").stars)], ["FORKS", String(repo("veronica-osint").forks)], ["RUNS IN", "Terminal"]],
      flavor: "Ask her in plain language; she picks the sources, reads the results and keeps the thread.",
    },
    {
      file: "meridian", art: "meridian", name: "MERIDIAN", type: "mistral",
      frame: ["#ffc53d", "#fa520f"], tint: "#fff8ee", hp: starsHp("meridian"),
      strip: "Multi-agent decisions · Mistral × ElevenLabs",
      moves: [
        { name: "Debate", cost: ["mistral"], value: "×3", text: "One agent argues for, one against, and a third delivers the verdict." },
        { name: "Voice Brief", cost: ["elevenlabs"], value: "", text: "Each agent speaks its findings in its own voice." },
      ],
      stats: [["STARS", String(repo("meridian").stars)], ["AGENTS", "3"], ["BUILT FOR", "Mistral 2026"]],
      flavor: "Three minds. One decision. Zero bias. Built for the Mistral Worldwide Hackathon.",
    },
    {
      file: "signal-canvas", art: "signal", name: "Signal Canvas", type: "nvidia",
      frame: ["#ff7ac0", "#9a4dff"], tint: "#fdf5ff", hp: starsHp("signal-canvas"),
      strip: "Investigation console · macOS · Hermes × NVIDIA",
      moves: [
        { name: "Case Vault", cost: ["telegram"], value: "", text: "Sessions, graph, chat and audit log, encrypted on your machine." },
        { name: "Desk Agent", cost: ["nousresearch", "nvidia"], value: "", text: "Scans, correlates and drafts briefs, reasoning on NVIDIA Nemotron." },
      ],
      stats: [["FORKS", String(repo("signal-canvas").forks)], ["PLATFORM", "macOS"], ["LICENSE", "MIT"]],
      flavor: "Human-in-the-loop review for NGOs and civil society. A Hermes × NVIDIA × Stripe hackathon build.",
    },
  ];
}

// ================================================================ main
const offline = process.argv.includes("--offline");
const snapshot = A("data.json");
const data = offline && existsSync(snapshot) ? JSON.parse(readFileSync(snapshot, "utf8")) : await fetchData();
if (!offline) writeFileSync(snapshot, JSON.stringify(data) + "\n");

const out = {};
const cards = deck(data);
cards.forEach((spec, i) => (out[`cards/${spec.file}.svg`] = card(spec, i, cards.length - 1)));
out["ecosystem.svg"] = ecosystem();
for (const k of ["x", "linkedin", "web", "mail", "github"]) out[`social/${k}.svg`] = social(k);

for (const dir of ["cards", "social"]) rmSync(A(dir), { recursive: true, force: true });
for (const [file, content] of Object.entries(out)) {
  mkdirSync(dirname(A(file)), { recursive: true });
  writeFileSync(A(file), content);
}
console.log(`wrote ${Object.keys(out).length} images · ${data.stars} stars · ${data.contributions} contributions · ${data.publicRepos} public projects`);
