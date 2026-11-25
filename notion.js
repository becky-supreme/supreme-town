// Reads Notion boards and pages into plain text so a bot can answer from them.
// A bot lists its sources in config/bots.json as "notion": ["<link or id>", ...].
//
// Starting from each source, it reads the pages and boards inside it. A bot with
// "followLinks": true in config/bots.json also follows links and @-mentions to pages
// kept elsewhere in Notion, so a hub that points out to other pages is read in full.
// That widens what the bot can repeat to anyone signed in, so it is off by default
// and limited to whatever the Notion connection has been given access to.
//
// Each page is kept as its own section, so a bot can be handed just the pages that
// matter to a question (see pickSections). Pages that haven't changed since the
// last sync are not downloaded again.
const API = 'https://api.notion.com/v1';
const VERSION = '2022-06-28';
const MAX_PAGES = 600; // pages and board cards read per bot
const MAX_CARDS = 200; // per board
const MAX_DEPTH = 3; // nested blocks (toggles, sub-bullets, columns)
const MAX_PAGE_CHARS = 60_000; // one very long page can't crowd out the rest

export const hasNotion = () => !!process.env.NOTION_TOKEN;

// Accepts a bare id or any Notion link and returns the 32-character id.
export function extractId(source) {
  // Links look like notion.so/team/Some-Title-<32 characters>?v=<view id>.
  const last = String(source).trim().split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop();
  const m = last.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i) || last.match(/[0-9a-f]{32}$/i);
  return m ? m[0].replace(/-/g, '').toLowerCase() : null;
}
const norm = (id) => String(id || '').replace(/-/g, '').toLowerCase();

// Notion allows about three requests a second.
let nextSlot = 0;
async function api(path, body) {
  for (let attempt = 0; ; attempt++) {
    const wait = nextSlot - Date.now();
    nextSlot = Math.max(Date.now(), nextSlot) + 340;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const res = await fetch(API + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${process.env.NOTION_TOKEN}`,
        'notion-version': VERSION,
        'content-type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, (Number(res.headers.get('retry-after')) || 1 + attempt) * 1000));
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
// Pages @-mentioned inside a piece of text.
const mentionedPages = (rich) => (rich || []).filter((t) => t.type === 'mention' && t.mention?.type === 'page').map((t) => norm(t.mention.page.id));
const mentionedBoards = (rich) => (rich || []).filter((t) => t.type === 'mention' && t.mention?.type === 'database').map((t) => norm(t.mention.database.id));

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
    case 'callout': return `> ${text}`;
    case 'code': return '```\n' + text + '\n```';
    case 'child_page': return `(Page: ${b.title})`;
    case 'child_database': return `(Board: ${b.title})`;
    case 'link_to_page': return '(Linked page)';
    case 'bookmark': case 'embed': case 'link_preview': return b.url || '';
    case 'table_row': return (b.cells || []).map(plain).join(' | ');
    default: return text;
  }
}

// One page's own text, plus the pages and boards it points to.
async function readBlocks(blockId, depth, links) {
  const lines = [];
  let cursor, n = 0;
  do {
    const page = await api(`/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`);
    for (const block of page.results) {
      n = block.type === 'numbered_list_item' ? n + 1 : 0;
      const line = blockLine(block, n);
      if (line) lines.push('  '.repeat(depth) + line);
      const b = block[block.type] || {};
      links.pages.push(...mentionedPages(b.rich_text));
      links.boards.push(...mentionedBoards(b.rich_text));
      if (block.type === 'table_row') for (const cell of b.cells || []) { links.pages.push(...mentionedPages(cell)); links.boards.push(...mentionedBoards(cell)); }
      if (block.type === 'child_page') { links.pages.push(norm(block.id)); links.children.push(`page:${norm(block.id)}`); }
      if (block.type === 'child_database') { links.boards.push(norm(block.id)); links.children.push(`board:${norm(block.id)}`); }
      if (block.type === 'link_to_page') {
        if (b.type === 'page_id') links.pages.push(norm(b.page_id));
        if (b.type === 'database_id') links.boards.push(norm(b.database_id));
      }
      const nested = block.has_children && block.type !== 'child_page' && block.type !== 'child_database';
      if (nested && depth < MAX_DEPTH) lines.push(await readBlocks(block.id, depth + 1, links));
    }
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return lines.filter(Boolean).join('\n');
}

// previous: the cache from the last sync, { pages: { id: { edited, title, text, links } } }
// Returns { sections: [{ id, title, text }], pages, items, notes, syncedAt }.
export async function readBotSources(sources, previous = {}, { followLinks = false } = {}) {
  const notes = [];
  const oldPages = previous.pages || {};
  const pages = {};
  const order = [];
  const queue = []; // { kind: 'page' | 'board', id }
  const seen = new Set();
  const push = (kind, id) => { const key = `${kind}:${id}`; if (id && !seen.has(key)) { seen.add(key); queue.push({ kind, id }); } };
  let skipped = 0, capped = false;

  for (const source of sources) {
    const id = extractId(source);
    if (!id) throw new Error(`"${source}" doesn't look like a Notion link or id.`);
    // A link could be a board or a page; try it as a board first.
    try {
      await api(`/databases/${id}`);
      push('board', id);
    } catch (err) {
      if (err.status !== 404 && err.status !== 400) throw err;
      push('page', id);
    }
  }

  async function readPage(page) {
    const id = norm(page.id);
    if (pages[id]) return;
    if (order.length >= MAX_PAGES) { capped = true; return; }
    const old = oldPages[id];
    let entry;
    if (old && old.edited === page.last_edited_time) {
      entry = old; // unchanged since last time
    } else {
      const links = { pages: [], boards: [], children: [] };
      let text = await readBlocks(id, 0, links);
      if (text.length > MAX_PAGE_CHARS) text = text.slice(0, MAX_PAGE_CHARS) + '\n(…the rest of this page was left out because it is very long)';
      const props = pageProperties(page);
      entry = { edited: page.last_edited_time, title: pageTitle(page), text: [props, text].filter(Boolean).join('\n'), links };
    }
    pages[id] = entry;
    order.push(id);
    // Pages and boards nested inside this one are always read; links elsewhere only when allowed.
    const kids = new Set(entry.links.children || []);
    for (const p of entry.links.pages) if (followLinks || kids.has(`page:${p}`)) push('page', p);
    for (const b of entry.links.boards) if (followLinks || kids.has(`board:${b}`)) push('board', b);
  }

  for (let i = 0; i < queue.length; i++) {
    const { kind, id } = queue[i];
    try {
      if (kind === 'page') {
        await readPage(await api(`/pages/${id}`));
      } else {
        let cursor, count = 0;
        do {
          const res = await api(`/databases/${id}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
          for (const card of res.results) { if (count++ < MAX_CARDS) await readPage(card); }
          cursor = res.has_more && count < MAX_CARDS ? res.next_cursor : null;
        } while (cursor);
        if (count >= MAX_CARDS) notes.push(`Only the first ${MAX_CARDS} cards of a board were read.`);
      }
    } catch (err) {
      // A linked page the integration hasn't been given, or a view of a board it can't open.
      if (err.status === 404 || err.status === 400 || err.status === 403) { skipped++; continue; }
      throw err;
    }
  }
  if (capped) notes.push(`Stopped after ${MAX_PAGES} pages.`);
  if (skipped) notes.push(`${skipped} linked page(s) or board(s) couldn't be opened; share them with the Notion connection to include them.`);
  const sections = order.map((id) => ({ id, title: pages[id].title, text: pages[id].text }));
  return { sections, pages, items: sections.length, notes, syncedAt: new Date().toISOString() };
}

// ---- choosing what a bot reads for a question ----
const STOP = new Set('the and for are but not you your with this that from have has had was were what when where which who why how can could should would will about into onto than then them they their there here our out all any each its it’s it\'s i’m im me my mine we us do does did done get got make made need want just also only some more most very like over under again been being off per via a an to of in on at by or as is be if so no up down'.split(' '));
const words = (s) => String(s).toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g)?.filter((w) => !STOP.has(w)) || [];

// Picks the pages most likely to answer the question, up to budget characters.
// Always starts with a contents list of every page, so the bot knows what exists.
export function pickSections(sections, question, budget = 160_000) {
  const contents = `Contents of the Notion pages you can read (${sections.length}):\n` + sections.map((s) => `- ${s.title}`).join('\n');
  const total = sections.reduce((n, s) => n + s.text.length + s.title.length + 4, 0);
  const asText = (list) => list.map((s) => `# ${s.title}\n${s.text}`).join('\n\n');
  if (total + contents.length <= budget) return `${contents}\n\n${asText(sections)}`; // it all fits
  const terms = [...new Set(words(question))];
  const scored = sections.map((s, i) => {
    const title = s.title.toLowerCase(), body = s.text.toLowerCase();
    let score = 0;
    for (const t of terms) {
      if (title.includes(t)) score += 12;
      let hits = 0, at = body.indexOf(t);
      while (at !== -1 && hits < 15) { hits++; at = body.indexOf(t, at + t.length); }
      score += hits;
    }
    return { s, i, score };
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  const chosen = [];
  let used = contents.length;
  for (const { s, score } of scored) {
    if (score === 0 && chosen.length) break;
    const size = s.text.length + s.title.length + 4;
    if (used + size > budget) continue;
    chosen.push(s); used += size;
  }
  chosen.sort((a, b) => sections.indexOf(a) - sections.indexOf(b));
  return `${contents}\n\nThe pages below were chosen as the most relevant to the question; the rest are listed above only by title.\n\n${asText(chosen)}`;
}

export function friendlyNotionError(err) {
  if (err.status === 401) return 'Notion rejected the token. Check NOTION_TOKEN in .env.';
  if (err.status === 404 || err.code === 'object_not_found') return "Notion can't see that page. Open it in Notion, click ••• → Connections, and add your developer connection.";
  return err.message || 'Notion sync failed.';
}
