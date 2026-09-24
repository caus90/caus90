// Generates the GitHub stats cards (SVG) used in the profile README.
// Runs in GitHub Actions with GITHUB_TOKEN; set MOCK=1 to render with fake data locally.
import { mkdirSync, writeFileSync } from 'node:fs';

const USER = process.env.GH_USER || 'caus90';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.OUT_DIR || 'dist';

const C = {
  bg: '#0d1117',
  border: '#00ff41',
  accent: '#00ff41',
  text: '#c9d1d9',
  dim: '#8b949e',
  track: '#161b22',
};
const FONT = "'Courier New', Consolas, monospace";

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': USER },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

async function fetchData() {
  const { user } = await gql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        followers { totalCount }
        pullRequests { totalCount }
        issues { totalCount }
        repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
          }
        }
        contributionsCollection { totalCommitContributions restrictedContributionsCount }
      }
    }`,
    { login: USER },
  );

  // Contribution calendar for every year since the account was created (needed for the longest streak).
  const days = [];
  const firstYear = new Date(user.createdAt).getUTCFullYear();
  const now = new Date();
  for (let y = firstYear; y <= now.getUTCFullYear(); y++) {
    const from = new Date(Date.UTC(y, 0, 1)).toISOString();
    const to = (y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59))).toISOString();
    const d = await gql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) { contributionsCollection(from: $from, to: $to) {
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        } }
      }`,
      { login: USER, from, to },
    );
    for (const w of d.user.contributionsCollection.contributionCalendar.weeks) days.push(...w.contributionDays);
  }

  const langs = {};
  for (const repo of user.repositories.nodes) {
    for (const { size, node } of repo.languages.edges) {
      langs[node.name] ??= { size: 0, color: node.color || C.accent };
      langs[node.name].size += size;
    }
  }

  return {
    stars: user.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    repos: user.repositories.totalCount,
    followers: user.followers.totalCount,
    prs: user.pullRequests.totalCount,
    issues: user.issues.totalCount,
    commits: user.contributionsCollection.totalCommitContributions + user.contributionsCollection.restrictedContributionsCount,
    langs,
    days: days.filter((d) => d.date <= now.toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function mockData() {
  const days = [];
  const today = new Date();
  for (let i = 400; i >= 0; i--) {
    const d = new Date(today - i * 864e5);
    days.push({ date: d.toISOString().slice(0, 10), contributionCount: Math.random() < 0.3 ? 0 : Math.floor(Math.random() * 12) });
  }
  return {
    stars: 42, repos: 12, followers: 30, prs: 57, issues: 19, commits: 1234,
    langs: { PHP: { size: 900, color: '#4F5D95' }, TypeScript: { size: 600, color: '#3178c6' }, JavaScript: { size: 300, color: '#f1e05a' }, Python: { size: 150, color: '#3572A5' }, Shell: { size: 80, color: '#89e051' }, CSS: { size: 40, color: '#563d7c' } },
    days,
  };
}

// Shared card chrome: dark panel, green border and a terminal-style title bar.
function card(w, h, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <style>
    text { font-family: ${FONT}; }
    .t { font-size: 14px; font-weight: 700; fill: ${C.accent}; }
    .l { font-size: 13px; fill: ${C.dim}; }
    .v { font-size: 14px; font-weight: 700; fill: ${C.text}; }
    .big { font-size: 30px; font-weight: 700; fill: ${C.accent}; }
    .fade { opacity: 0; animation: in .5s ease forwards; }
    @keyframes in { to { opacity: 1; } }
  </style>
  <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="10" fill="${C.bg}" stroke="${C.border}" stroke-opacity=".5" stroke-width="1.5"/>
  <circle cx="18" cy="18" r="4" fill="#ff5f56"/><circle cx="32" cy="18" r="4" fill="#ffbd2e"/><circle cx="46" cy="18" r="4" fill="#27c93f"/>
  <text x="62" y="23" class="t">${esc(title)}</text>
  <line x1="1" y1="34" x2="${w - 1}" y2="34" stroke="${C.border}" stroke-opacity=".25"/>
${body}
</svg>
`;
}

function statsCard(d) {
  const rows = [
    ['Total stars', d.stars],
    ['Commits (last year)', d.commits],
    ['Pull requests', d.prs],
    ['Issues', d.issues],
    ['Public repos', d.repos],
    ['Followers', d.followers],
  ];
  const body = rows
    .map(([label, value], i) => {
      const y = 62 + i * 24;
      return `  <g class="fade" style="animation-delay:${i * 120}ms">
    <text x="22" y="${y}" class="l"><tspan fill="${C.accent}">&gt;</tspan> ${esc(label)}</text>
    <text x="418" y="${y}" class="v" text-anchor="end">${fmt(value)}</text>
  </g>`;
    })
    .join('\n');
  return card(440, 210, `${USER}@github:~$ stats`, body);
}

function langsCard(d) {
  const all = Object.entries(d.langs).sort((a, b) => b[1].size - a[1].size);
  const total = all.reduce((s, [, l]) => s + l.size, 0) || 1;
  const top = all.slice(0, 6);
  const barW = 356;
  let x = 22;
  const bar = top
    .map(([, l]) => {
      const w = (l.size / total) * barW;
      const r = `<rect x="${x.toFixed(1)}" y="50" width="${Math.max(w, 1).toFixed(1)}" height="8" fill="${l.color}"/>`;
      x += w;
      return r;
    })
    .join('');
  const list = top
    .map(([name, l], i) => {
      const cx = i % 2 === 0 ? 22 : 212;
      const y = 90 + Math.floor(i / 2) * 26;
      return `  <g class="fade" style="animation-delay:${i * 120}ms">
    <circle cx="${cx + 5}" cy="${y - 4}" r="5" fill="${l.color}"/>
    <text x="${cx + 16}" y="${y}" class="v" style="font-size:13px">${esc(name)} <tspan class="l">${((l.size / total) * 100).toFixed(1)}%</tspan></text>
  </g>`;
    })
    .join('\n');
  const body = all.length
    ? `  <clipPath id="bar"><rect x="22" y="50" width="${barW}" height="8" rx="4"/></clipPath>
  <rect x="22" y="50" width="${barW}" height="8" rx="4" fill="${C.track}"/>
  <g clip-path="url(#bar)">${bar}</g>
${list}`
    : `  <text x="200" y="120" class="l" text-anchor="middle">no public code yet</text>`;
  return card(400, 210, '~$ top-languages', body);
}

function streaks(days) {
  let longest = 0, run = 0;
  for (const d of days) {
    run = d.contributionCount > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today not having contributions yet does not break the current streak.
  let i = days.length - 1;
  if (i >= 0 && days[i].contributionCount === 0) i--;
  let current = 0;
  while (i >= 0 && days[i].contributionCount > 0) { current++; i--; }
  const total = days.reduce((s, d) => s + d.contributionCount, 0);
  return { total, current, longest, since: days[0]?.date ?? '' };
}

function streakCard(d) {
  const s = streaks(d.days);
  const cols = [
    [fmt(s.total), 'Total contributions', `since ${s.since}`],
    [s.current, 'Current streak', s.current === 1 ? 'day' : 'days'],
    [s.longest, 'Longest streak', s.longest === 1 ? 'day' : 'days'],
  ];
  const body = cols
    .map(([value, label, hint], i) => {
      const cx = 142 + i * 283;
      return `  <g class="fade" style="animation-delay:${i * 150}ms">
    <text x="${cx}" y="90" class="big" text-anchor="middle">${esc(value)}</text>
    <text x="${cx}" y="118" class="v" text-anchor="middle">${esc(label)}</text>
    <text x="${cx}" y="138" class="l" text-anchor="middle">${esc(hint)}</text>
  </g>`;
    })
    .join('\n');
  const sep = [283, 566].map((x) => `  <line x1="${x}" y1="55" x2="${x}" y2="145" stroke="${C.border}" stroke-opacity=".2"/>`).join('\n');
  return card(850, 165, '~$ streak --all-time', `${sep}\n${body}`);
}

function activityCard(d) {
  const last = d.days.slice(-31);
  const W = 850, H = 260, left = 50, right = 25, top = 55, bottom = 45;
  const pw = W - left - right, ph = H - top - bottom;
  const max = Math.max(4, ...last.map((x) => x.contributionCount));
  const step = pw / Math.max(last.length - 1, 1);
  const pts = last.map((x, i) => [left + i * step, top + ph - (x.contributionCount / max) * ph]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${(left + pw).toFixed(1)},${top + ph} L${left},${top + ph} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((f) => {
      const y = top + ph - f * ph;
      return `  <line x1="${left}" y1="${y}" x2="${left + pw}" y2="${y}" stroke="${C.dim}" stroke-opacity=".15"/>
  <text x="${left - 10}" y="${y + 4}" class="l" text-anchor="end" style="font-size:11px">${Math.round(f * max)}</text>`;
    })
    .join('\n');
  const labels = last
    .map((x, i) => (i % 5 === 0 || i === last.length - 1 ? `  <text x="${(left + i * step).toFixed(1)}" y="${H - 22}" class="l" text-anchor="middle" style="font-size:11px">${x.date.slice(8)}/${x.date.slice(5, 7)}</text>` : ''))
    .filter(Boolean)
    .join('\n');
  const dots = pts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="${C.bg}" stroke="${C.accent}" stroke-width="2"/>`).join('');
  const len = Math.ceil(pw * 3);
  const body = `  <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.accent}" stop-opacity=".35"/><stop offset="1" stop-color="${C.accent}" stop-opacity="0"/></linearGradient></defs>
${grid}
${labels}
  <path d="${area}" fill="url(#fill)" class="fade" style="animation-delay:.8s"/>
  <path d="${line}" fill="none" stroke="${C.accent}" stroke-width="2.5" stroke-linejoin="round" stroke-dasharray="${len}" stroke-dashoffset="${len}" style="animation: draw 1.6s ease forwards"/>
  <g class="fade" style="animation-delay:1.4s">${dots}</g>
  <style>@keyframes draw { to { stroke-dashoffset: 0; } }</style>`;
  return card(W, H, '~$ activity --last 31d', body);
}

const data = process.env.MOCK ? mockData() : await fetchData();
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stats.svg`, statsCard(data));
writeFileSync(`${OUT}/langs.svg`, langsCard(data));
writeFileSync(`${OUT}/streak.svg`, streakCard(data));
writeFileSync(`${OUT}/activity.svg`, activityCard(data));
console.log(`Cards written to ${OUT}/`);
