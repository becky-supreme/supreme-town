// Reads Notion boards and pages into plain text so a bot can answer from them.
// A bot lists its sources in config/bots.json as "notion": ["<link or id>", ...].
// A source can be a board (database): every card becomes a section with its
// properties and its page content. Or it can be a single page.
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const MAX_CARDS = 200; // per board
const MAX_CHARS = 300_000; // per bot
const MAX_DEPTH = 3; // nested blocks (toggles, sub-bullets)
const MAX_SUBPAGES = 80; // pages and boards found inside a page are read too, up to this many per bot

export const hasNotion = () => !!process.env.NOTION_TOKEN;

// Accepts a bare id or any Notion link and returns the 32-character id.
export function extractId(source) {
  // Links look like notion.so/team/Some-Title-<32 characters>?v=<view id>.
  const last = String(source).trim().split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop();
  const m = last.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) || last.match(/[0-9a-f]{32}$/i);
  return m ? m[0].replace(/-/g, '').toLowerCase() : null;
}

async function api(path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        'notion-version': VERSION,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 4) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 1) * 1000));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Notion returned ${res.status}`);
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }
}

const plain = (rich) => (rich || []).map((t) => t.plain_text).join('');

function propertyText(p) {
  switch (p?.type) {
    case 'title': return plain(p.title);
    case 'rich_text': return plain(p.rich_text);
    case 'select': return p.select?.name || '';
    case 'status': return p.status?.name || '';
    case 'multi_select': return p.multi_select.map((s) => s.name).join(', ');
    case 'people': return p.people.map((u) => u.name).filter(Boolean).join(', ');
    case 'date': return p.date ? [p.date.start, p.date.end].filter(Boolean).join(' to ') : '';
    case 'checkbox': return p.checkbox ? 'yes' : 'no';
    case 'number': return p.number ?? '';
    case 'url': return p.url || '';
    case 'email': return p.email || '';
    case 'phone_number': return p.phone_number || '';
    case 'formula': return p.formula?.[p.formula.type] ?? '';
    default: return '';
  }
}
function pageTitle(page) {
  const title = Object.values(page.properties || {}).find((p) => p.type === 'title');
  return plain(title?.title) || 'Untitled';
}
function pageProperties(page) {
  const lines = [];
  for (const [name, p] of Object.entries(page.properties || {})) {
    if (p.type === 'title') continue;
    const value = String(propertyText(p)).trim();
    if (value) lines.push(`${name}: ${value}`);
  }
  return lines.join('\n');
}

function blockLine(block, n) {
  const b = block[block.type] || {};
  const text = plain(b.rich_text);
  switch (block.type) {
    case 'heading_1': return `## ${text}`;
    case 'heading_2': return `### ${text}`;
    case 'heading_3': return `#### ${text}`;
    case 'bulleted_list_item': return `- ${text}`;
    case 'numbered_list_item': return `${n}. ${text}`;
    case 'to_do': return `- [${b.checked ? 'x' : ' '}] ${text}`;
    case 'quote': return `> ${text}`;
    case 'code': return '```\n' + text + '\n```';
    case 'child_page': return `(Sub-page: ${b.title})`;
    case 'child_database': return `(Board inside this page: ${b.title})`;
    case 'bookmark': case 'embed': case 'link_preview': return b.url || '';
    case 'table_row': return (b.cells || []).map(plain).join(' | ');
    default: return text;
  }
}

async function blocksText(blockId, depth = 0, ctx = { sub: 0, notes: [] }) {
  const lines = [];
  let cursor, n = 0;
  do {
    const page = await api(`/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const block of page.results) {
      n = block.type === 'numbered_list_item' ? n + 1 : 0;
      const line = blockLine(block, n);
      if (line) lines.push('  '.repeat(depth) + line);
      const nested = block.has_children && block.type !== 'child_page' && block.type !== 'child_database';
      if (nested && depth < MAX_DEPTH) lines.push(await blocksText(block.id, depth + 1, ctx));
      // A hub page is mostly links to pages and boards inside it: follow them.
      if (block.type === 'child_page' || block.type === 'child_database') {
        if (ctx.sub >= MAX_SUBPAGES) {
          if (!ctx.capped) { ctx.capped = true; ctx.notes.push(`Only the first ${MAX_SUBPAGES} pages inside the linked page were read.`); }
          continue;
        }
        ctx.sub++;
        try {
          const inner = block.type === 'child_page'
            ? await blocksText(block.id, 0, ctx)
            : (await readBoard(block.id, ctx.notes, ctx)).text;
          if (inner) lines.push(`\n# ${block[block.type].title}\n${inner}`);
        } catch (err) {
          if (err.status !== 404 && err.status !== 400) throw err; // linked views of other boards can't be read; skip them
        }
      }
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return lines.filter(Boolean).join('\n');
}

async function readBoard(id, notes, ctx = { sub: 0, notes }) {
  const cards = [];
  let cursor;
  do {
    const page = await api(`/databases/${id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    cards.push(...page.results);
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor && cards.length < MAX_CARDS);
  if (cursor || cards.length > MAX_CARDS) notes.push(`Only the first ${MAX_CARDS} cards of a board were read.`);
  const out = [];
  for (const card of cards.slice(0, MAX_CARDS)) {
    const body = await blocksText(card.id, 0, ctx);
    out.push([`# ${pageTitle(card)}`, pageProperties(card), body].filter(Boolean).join('\n'));
  }
  return { text: out.join('\n\n'), count: out.length };
}

async function readSource(source, notes) {
  const id = extractId(source);
  if (!id) throw new Error(`"${source}" doesn't look like a Notion link or id.`);
  const ctx = { sub: 0, notes };
  try {
    const board = await readBoard(id, notes, ctx);
    return { text: board.text, count: board.count + ctx.sub };
  } catch (err) {
    // Not a board: read it as a single page instead.
    if (err.status !== 404 && err.status !== 400) throw err;
  }
  const page = await api(`/pages/${id}`);
  const body = await blocksText(id, 0, ctx);
  return { text: [`# ${pageTitle(page)}`, pageProperties(page), body].filter(Boolean).join('\n'), count: 1 + ctx.sub };
}

// Returns { text, items, notes, syncedAt } for one bot, or throws.
export async function readBotSources(sources) {
  const notes = [];
  const parts = [];
  let items = 0;
  for (const source of sources) {
    const { text, count } = await readSource(source, notes);
    parts.push(text);
    items += count;
  }
  let text = parts.join('\n\n');
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    notes.push(`The Notion content was longer than ${MAX_CHARS} characters, so the end was left out.`);
  }
  return { text, items, notes, syncedAt: new Date().toISOString() };
}

export function friendlyNotionError(err) {
  if (err.status === 401) return 'Notion rejected the token. Check NOTION_TOKEN in .env.';
  if (err.status === 404 || err.code === 'object_not_found') return "Notion can't see that page. Open it in Notion, click ••• → Connections, and add your developer connection.";
  return err.message || 'Notion sync failed.';
}
