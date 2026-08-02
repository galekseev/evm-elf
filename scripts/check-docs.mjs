#!/usr/bin/env node
/**
 * Validator for the reverse-engineered and architecture documents in docs/.
 *
 * Three kinds of rot have been found here by a reader rather than by a build,
 * and this checks for all three.
 *
 * The `// REQ-NNN` comments in test/characterization/ are the only record of
 * which requirement each test exercises, and clause 4 of the requirements
 * specification is derived from them: §4.1 counts the covered requirements by
 * verification method and §4.4 lists them by clause. Nothing validated either
 * against the comments, so a renumbered requirement, a retired one, or a test
 * that gained coverage left the tables quietly wrong. `npm run check:features`
 * already fails when a Gherkin scenario names a requirement the specification
 * does not define; this does the same for the test suite, then recomputes both
 * tables from the comments and diffs them against what the document claims.
 *
 * In-page anchors and relative links are checked in every document under
 * docs/reverse-engineer/ and docs/architecture/. The requirement mapping is
 * checked against the specification alone, which is the only document that
 * states one.
 *
 * Zero dependencies, run as `npm run check:docs`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_PATH = join(REPO_ROOT, 'docs', 'reverse-engineer', 'requirements-specification.md');
const SUITE_DIR = join(REPO_ROOT, 'test', 'characterization');
const DOC_DIRS = [
  join(REPO_ROOT, 'docs', 'reverse-engineer'),
  join(REPO_ROOT, 'docs', 'architecture'),
];

const SPEC = relative(REPO_ROOT, SPEC_PATH);
const SUITE = relative(REPO_ROOT, SUITE_DIR);

/**
 * Requirements §4.4 records as untested by design rather than by omission:
 * properties of package.json and LICENSE, assigned Inspection, which no
 * behavioural test reaches. Every other uncovered requirement has to match the
 * comments; these four have to stay uncovered, or the paragraph beneath the
 * table is wrong.
 */
const UNCOVERED_BY_DESIGN = new Map([
  ['REQ-139', 'the Node.js 22 floor'],
  ['REQ-141', 'build and run-from-source scripts'],
  ['REQ-142', 'the five runtime dependencies'],
  ['REQ-143', 'MIT licensing'],
]);

const METHODS = ['Test', 'Demonstration', 'Inspection', 'Analysis'];
const METHOD_WORD = /\b(Test|Demonstration|Inspection|Analysis)\b/g;

/**
 * A definition is three digits, as §1.4.3 requires and check-features.mjs also
 * assumes, so `##### REQ-1480:` is not silently a 148th requirement. A
 * reference is any run of digits, because catching `REQ-99` and `REQ-1234` in a
 * comment is the point of the check that reads them.
 */
const REQ_DEFINITION = /^(REQ-\d{3}):/;
const REQ_REFERENCE = /REQ-\d+/g;

const findings = [];

function report(file, line, message) {
  findings.push({ file, line, message });
}

function list(ids) {
  return ids.length === 0 ? 'none' : ids.join(', ');
}

function sum(counts) {
  return [...counts.values()].reduce((total, value) => total + value, 0);
}

/**
 * The file's lines with fenced code blocks blanked, so that a `#` line or a
 * bracketed example inside one is not read as a heading or a link. Line numbers
 * survive because every finding cites one.
 */
function codeFreeLines(text) {
  let fence;
  return text.split('\n').map((line) => {
    const delimiter = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence !== undefined) {
      if (delimiter && line.trim().startsWith(fence)) {
        fence = undefined;
      }
      return '';
    }
    if (delimiter) {
      fence = delimiter[1];
      return '';
    }
    return line;
  });
}

/** GitHub's heading-anchor slug: lower-cased, punctuation dropped, spaces hyphenated */
function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\p{M}_ -]/gu, '')
    .replace(/ /g, '-');
}

/** Trailing `#`s close an ATX heading and are not part of its text */
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

function filesUnder(dir, extension) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(path, extension));
    } else if (entry.name.endsWith(extension)) {
      found.push(path);
    }
  }
  return found.sort();
}

/**
 * Every anchor the file's headings generate. A repeated heading text gets the
 * `-1`, `-2` suffix GitHub appends, and an explicit `<a name>` counts too.
 */
function anchorsOf(path) {
  const anchors = new Set();
  const seen = new Map();
  for (const line of codeFreeLines(readFileSync(path, 'utf-8'))) {
    const heading = HEADING.exec(line);
    if (heading) {
      const base = slug(heading[2]);
      const repeats = seen.get(base) ?? 0;
      seen.set(base, repeats + 1);
      anchors.add(repeats === 0 ? base : `${base}-${repeats}`);
    }
    for (const explicit of line.matchAll(/<a\s[^>]*(?:name|id)="([^"]+)"/g)) {
      anchors.add(explicit[1]);
    }
  }
  return anchors;
}

/**
 * Every link in the file, as `{ line, target }`. Inline code becomes a
 * same-length run of `x` first, so link syntax quoted as an example is not
 * followed while the column a finding would cite stays right.
 */
function linksOf(path) {
  const links = [];
  for (const [index, line] of codeFreeLines(readFileSync(path, 'utf-8')).entries()) {
    const scannable = line.replace(/`+[^`]*`+/g, (span) => 'x'.repeat(span.length));
    const matches = [
      ...scannable.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g),
      ...scannable.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/g),
    ];
    for (const match of matches) {
      links.push({ line: index + 1, target: match[1] });
    }
  }
  return links;
}

/**
 * Comment text, line by line, split by comment form. The two forms mean
 * different things here: a line comment naming a requirement is the claim of
 * coverage §4.1 defines, while a file header naming one in prose is not — §4.1
 * says as much, so the mapping must not be built from it. Both have to name a
 * requirement that exists.
 */
function commentsOf(text) {
  const comments = [];
  let inBlock = false;
  for (const [index, raw] of text.split('\n').entries()) {
    const number = index + 1;
    let rest = raw;
    while (rest !== '') {
      if (inBlock) {
        const close = rest.indexOf('*/');
        comments.push({ number, kind: 'block', text: close === -1 ? rest : rest.slice(0, close) });
        if (close === -1) {
          break;
        }
        inBlock = false;
        rest = rest.slice(close + 2);
        continue;
      }
      const lineAt = rest.indexOf('//');
      const blockAt = rest.indexOf('/*');
      if (lineAt !== -1 && (blockAt === -1 || lineAt < blockAt)) {
        comments.push({ number, kind: 'line', text: rest.slice(lineAt + 2) });
        break;
      }
      if (blockAt === -1) {
        break;
      }
      inBlock = true;
      rest = rest.slice(blockAt + 2);
    }
  }
  return comments;
}

/** The lines of the section starting at `heading`, up to the next heading as shallow */
function sectionBody(lines, heading) {
  const level = HEADING.exec(lines[heading - 1])?.[1].length ?? 6;
  const body = [];
  for (let index = heading; index < lines.length; index += 1) {
    const next = HEADING.exec(lines[index]);
    if (next && next[1].length <= level) {
      break;
    }
    body.push(lines[index]);
  }
  return body;
}

/** The first pipe table in a section, delimiter row dropped */
function tableIn(body, heading) {
  const rows = [];
  let started = false;
  for (const [offset, line] of body.entries()) {
    if (!line.trim().startsWith('|')) {
      if (started) {
        break;
      }
      continue;
    }
    started = true;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
      continue;
    }
    rows.push({ number: heading + offset, cells });
  }
  return rows.length === 0 ? undefined : rows;
}

function plain(cell) {
  return cell.replace(/\*\*/g, '').trim();
}

function count(cell) {
  const text = plain(cell);
  return /^\d+$/.test(text) ? Number(text) : undefined;
}

/**
 * One pass over the specification: the requirement blocks with their clause and
 * their verification methods, and the line each numbered heading sits on.
 */
function parseSpec() {
  const lines = codeFreeLines(readFileSync(SPEC_PATH, 'utf-8'));
  const requirements = new Map();
  const sections = new Map();

  let clause;
  let current;
  for (const [index, line] of lines.entries()) {
    const heading = HEADING.exec(line);
    if (heading) {
      const requirement = REQ_DEFINITION.exec(heading[2]);
      if (requirement && heading[1].length === 5) {
        current = { id: requirement[1], line: index + 1, clause, verification: '' };
        requirements.set(current.id, current);
        continue;
      }
      current = undefined;
      const numbered = /^(\d+(?:\.\d+)*)\s/.exec(heading[2]);
      if (numbered) {
        clause = numbered[1];
        sections.set(numbered[1], index + 1);
      } else if (heading[1].length <= 2) {
        clause = undefined;
      }
      continue;
    }

    const attribute = /^- \*\*Verification\*\* — (.*)$/.exec(line);
    if (attribute && current) {
      // A wrapped attribute continues on indented lines until the next one.
      let text = attribute[1];
      for (let next = index + 1; next < lines.length; next += 1) {
        if (lines[next].trim() === '' || /^(- \*\*|#{1,6}\s)/.test(lines[next])) {
          break;
        }
        text += ` ${lines[next].trim()}`;
      }
      current.verification = text;
    }
  }

  for (const requirement of requirements.values()) {
    const named = [...requirement.verification.matchAll(METHOD_WORD)].map((match) => match[1]);
    requirement.methods = [...new Set(named)];
    if (requirement.methods.length === 0) {
      report(
        SPEC,
        requirement.line,
        `${requirement.id} has no Verification attribute naming one of ${METHODS.join(', ')}`
      );
    }
  }

  return { lines, requirements, sections };
}

/** Every requirement a comment in the suite names, and which of them count as covered */
function parseSuite(files) {
  const references = [];
  const covered = new Set();

  for (const path of files) {
    const shown = relative(REPO_ROOT, path);
    for (const comment of commentsOf(readFileSync(path, 'utf-8'))) {
      for (const match of comment.text.matchAll(REQ_REFERENCE)) {
        references.push({ file: shown, line: comment.number, id: match[0], kind: comment.kind });
        if (comment.kind === 'line') {
          covered.add(match[0]);
        }
      }
    }
  }

  return { references, covered };
}

/** Rule 1: a comment may only name a requirement the specification defines */
function checkReferences(spec, suite) {
  for (const reference of suite.references) {
    if (!spec.requirements.has(reference.id)) {
      report(reference.file, reference.line, `${reference.id} is not defined in ${SPEC}`);
    }
  }
}

/**
 * Rule 2, first half: §4.1's coverage column against the comments, and its
 * aggregate columns against the Verification attributes they claim to sum. The
 * share column is left alone. §4.1 states the convention it rounds by, so the
 * obstacle is not an unstated one: four shares rounded independently need not
 * sum to 100, and recomputing them would mean encoding a rule for which share
 * to adjust when they do not — a tie-break the document has no reason to
 * promise, and would then be held to.
 */
function checkMethodTable(spec, covered) {
  const heading = spec.sections.get('4.1');
  if (heading === undefined) {
    report(SPEC, 0, 'no §4.1 heading, so its method table cannot be checked');
    return;
  }
  const rows = tableIn(sectionBody(spec.lines, heading), heading);
  if (rows === undefined || rows[0].cells.length !== 5) {
    report(SPEC, heading, '§4.1 has no five-column method table');
    return;
  }

  const primary = new Map(METHODS.map((method) => [method, 0]));
  const also = new Map(METHODS.map((method) => [method, 0]));
  const tested = new Map(METHODS.map((method) => [method, 0]));
  for (const requirement of spec.requirements.values()) {
    const [first, ...rest] = requirement.methods;
    if (first === undefined) {
      continue;
    }
    primary.set(first, primary.get(first) + 1);
    for (const method of rest) {
      also.set(method, also.get(method) + 1);
    }
    if (covered.has(requirement.id)) {
      tested.set(first, tested.get(first) + 1);
    }
  }

  const columns = [
    { cell: 1, name: 'primary-method count', derived: primary, total: spec.requirements.size },
    { cell: 2, name: 'also-named count', derived: also, total: sum(also) },
    { cell: 4, name: 'coverage', derived: tested, total: covered.size },
  ];

  const seen = new Set();
  for (const row of rows.slice(1)) {
    const label = plain(row.cells[0]);
    if (label === 'Total') {
      seen.add(label);
      for (const column of columns) {
        if (count(row.cells[column.cell]) !== column.total) {
          report(
            SPEC,
            row.number,
            `§4.1's Total row gives a ${column.name} of ${plain(row.cells[column.cell])}; the derived total is ${column.total}`
          );
        }
      }
      continue;
    }

    const method = METHODS.find((name) => label.startsWith(name));
    if (method === undefined) {
      report(SPEC, row.number, `§4.1 row "${label}" names no known verification method`);
      continue;
    }
    seen.add(method);
    for (const column of columns) {
      const derived = column.derived.get(method);
      if (count(row.cells[column.cell]) !== derived) {
        report(
          SPEC,
          row.number,
          `§4.1 gives ${method} a ${column.name} of ${plain(row.cells[column.cell])}; the derived ${column.name} is ${derived}`
        );
      }
    }
  }

  for (const row of [...METHODS, 'Total']) {
    if (!seen.has(row)) {
      report(SPEC, heading, `§4.1's method table has no ${row} row`);
    }
  }
}

/** `REQ-019, REQ-021` and `REQ-082 – REQ-103` both expand to a set of identifiers */
function expandRequirementList(cell) {
  const text = plain(cell);
  if (text === '' || text === '—' || text === '-') {
    return { ids: [], malformed: [] };
  }
  const ids = [];
  const malformed = [];
  for (const item of text.split(',').map((part) => part.trim())) {
    const range = /^REQ-(\d{3})\s*[-–—]\s*REQ-(\d{3})$/.exec(item);
    const single = /^REQ-\d{3}$/.exec(item);
    if (single) {
      ids.push(item);
    } else if (range && Number(range[1]) <= Number(range[2])) {
      for (let value = Number(range[1]); value <= Number(range[2]); value += 1) {
        ids.push(`REQ-${String(value).padStart(3, '0')}`);
      }
    } else {
      malformed.push(item);
    }
  }
  return { ids, malformed };
}

/**
 * Rule 2, second half: §4.4's per-clause counts and its untested lists against
 * the comments, plus the size of the suite the section opens by quoting. The
 * file count is checked and the test count is not — tests generated inside a
 * loop are not countable from the source, and `npm test` reports the number
 * anyway.
 */
function checkTraceabilityTable(spec, covered, suiteFiles) {
  const heading = spec.sections.get('4.4');
  if (heading === undefined) {
    report(SPEC, 0, 'no §4.4 heading, so its traceability table cannot be checked');
    return;
  }
  const body = sectionBody(spec.lines, heading);
  const rows = tableIn(body, heading);
  if (rows === undefined || rows[0].cells.length !== 3) {
    report(SPEC, heading, '§4.4 has no three-column traceability table');
    return;
  }

  const claimed = [];
  let totalRow;
  for (const row of rows.slice(1)) {
    const label = plain(row.cells[0]);
    if (label === 'Total') {
      totalRow = row;
      continue;
    }
    const clause = /^(\d+(?:\.\d+)*)\b/.exec(label);
    if (clause) {
      claimed.push({ row, label, clause: clause[1] });
    } else {
      report(SPEC, row.number, `§4.4 row "${label}" does not start with a clause number`);
    }
  }

  // A row stands for its clause and everything under it, which is how one §3.7
  // row covers the requirements sitting in §3.7.1 to §3.7.3.
  const owner = new Map();
  for (const requirement of spec.requirements.values()) {
    const owners = claimed.filter(
      (entry) =>
        requirement.clause === entry.clause || requirement.clause?.startsWith(`${entry.clause}.`)
    );
    if (owners.length === 1) {
      owner.set(requirement.id, owners[0]);
    } else if (owners.length === 0) {
      report(
        SPEC,
        requirement.line,
        `${requirement.id} is under §${requirement.clause ?? '?'}, which has no row in §4.4`
      );
    } else {
      report(
        SPEC,
        requirement.line,
        `${requirement.id} is claimed by ${owners.length} §4.4 rows: ${owners.map((entry) => entry.clause).join(', ')}`
      );
    }
  }

  for (const entry of claimed) {
    const members = [...spec.requirements.values()].filter(
      (requirement) => owner.get(requirement.id) === entry
    );
    if (members.length === 0) {
      report(SPEC, entry.row.number, `§4.4 row "${entry.label}" matches no requirement`);
      continue;
    }
    const untested = members
      .filter((requirement) => !covered.has(requirement.id))
      .map((requirement) => requirement.id);

    const fraction = /^(\d+)\/(\d+)$/.exec(plain(entry.row.cells[1]));
    if (!fraction) {
      report(
        SPEC,
        entry.row.number,
        `§4.4 row "${entry.label}" has "${plain(entry.row.cells[1])}" where a covered/total count belongs`
      );
    } else {
      if (Number(fraction[1]) !== members.length - untested.length) {
        report(
          SPEC,
          entry.row.number,
          `§4.4 row "${entry.label}" claims ${fraction[1]} covered; the comments cover ${members.length - untested.length}`
        );
      }
      if (Number(fraction[2]) !== members.length) {
        report(
          SPEC,
          entry.row.number,
          `§4.4 row "${entry.label}" claims ${fraction[2]} requirements; §${entry.clause} defines ${members.length}`
        );
      }
    }

    const listed = expandRequirementList(entry.row.cells[2]);
    for (const item of listed.malformed) {
      report(
        SPEC,
        entry.row.number,
        `§4.4 row "${entry.label}" lists "${item}", which is neither a REQ-NNN nor a REQ-NNN – REQ-NNN range`
      );
    }
    const wrong =
      listed.ids.some((id) => !untested.includes(id)) ||
      untested.some((id) => !listed.ids.includes(id));
    if (wrong) {
      report(
        SPEC,
        entry.row.number,
        `§4.4 row "${entry.label}" lists ${list(listed.ids)} as untested; the comments leave ${list(untested)} untested`
      );
    }
  }

  if (totalRow === undefined) {
    report(SPEC, heading, "§4.4's traceability table has no Total row");
  } else {
    const fraction = /^(\d+)\/(\d+)$/.exec(plain(totalRow.cells[1]));
    if (!fraction) {
      report(
        SPEC,
        totalRow.number,
        `§4.4's Total row has "${plain(totalRow.cells[1])}" where a covered/total count belongs`
      );
    } else {
      if (Number(fraction[1]) !== covered.size) {
        report(
          SPEC,
          totalRow.number,
          `§4.4's Total row claims ${fraction[1]} covered; the comments cover ${covered.size}`
        );
      }
      if (Number(fraction[2]) !== spec.requirements.size) {
        report(
          SPEC,
          totalRow.number,
          `§4.4's Total row claims ${fraction[2]} requirements; the document defines ${spec.requirements.size}`
        );
      }
    }
    const uncovered = spec.requirements.size - covered.size;
    if (count(totalRow.cells[2]) !== uncovered) {
      report(
        SPEC,
        totalRow.number,
        `§4.4's Total row claims ${plain(totalRow.cells[2])} untested; the comments leave ${uncovered} untested`
      );
    }
  }

  for (const [requirement, reason] of UNCOVERED_BY_DESIGN) {
    if (covered.has(requirement)) {
      report(
        SPEC,
        heading,
        `${requirement} (${reason}) now has a test, but §4.4 still calls it uncovered by design`
      );
    }
  }

  const quoted = /(\d+) tests across (\d+) files/.exec(body.join('\n'));
  if (!quoted) {
    report(SPEC, heading, '§4.4 no longer gives the size of the suite as "N tests across N files"');
  } else if (Number(quoted[2]) !== suiteFiles.length) {
    report(SPEC, heading, `§4.4 says the suite is ${quoted[2]} files; ${SUITE} holds ${suiteFiles.length}`);
  }
}

/** Rule 3: every in-page anchor and relative link resolves */
function checkLinks(docs) {
  const cache = new Map();
  const anchorsFor = (path) => {
    if (!cache.has(path)) {
      cache.set(path, anchorsOf(path));
    }
    return cache.get(path);
  };

  let anchors = 0;
  let paths = 0;
  for (const path of docs) {
    const shown = relative(REPO_ROOT, path);
    for (const { line, target } of linksOf(path)) {
      // A scheme means the network or a mail client, neither of which this reaches.
      if (target === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) {
        continue;
      }
      const [file, fragment] = target.split('#');

      if (file === '') {
        anchors += 1;
        if (!anchorsFor(path).has(decodeURIComponent(fragment ?? ''))) {
          report(shown, line, `no heading in this file generates the anchor ${target}`);
        }
        continue;
      }

      paths += 1;
      const resolved = resolve(dirname(path), decodeURIComponent(file));
      if (!existsSync(resolved)) {
        report(shown, line, `${file} does not exist`);
      } else if (fragment !== undefined && resolved.endsWith('.md')) {
        if (!anchorsFor(resolved).has(decodeURIComponent(fragment))) {
          report(shown, line, `no heading in ${file} generates the anchor #${fragment}`);
        }
      }
    }
  }
  return { anchors, paths };
}

function main() {
  const docs = DOC_DIRS.flatMap((dir) => filesUnder(dir, '.md'));
  const suiteFiles = filesUnder(SUITE_DIR, '.ts');
  const spec = parseSpec();
  const suite = parseSuite(suiteFiles);

  checkReferences(spec, suite);

  // A requirement that does not exist cannot be covered, so the mapping is
  // built from the defined ones only. Rule 1 has already reported the rest, and
  // counting them here would turn one finding into a page of miscounts.
  const covered = new Set([...suite.covered].filter((id) => spec.requirements.has(id)));

  checkMethodTable(spec, covered);
  checkTraceabilityTable(spec, covered, suiteFiles);
  const links = checkLinks(docs);

  const proseOnly = new Set(
    suite.references
      .filter((reference) => reference.kind === 'block' && !covered.has(reference.id))
      .map((reference) => reference.id)
  );

  console.log('');
  console.log(`  documents              ${docs.length}`);
  console.log(`  requirements defined   ${spec.requirements.size}`);
  console.log(`  suite files            ${suiteFiles.length}`);
  console.log(`  REQ-NNN references     ${suite.references.length}`);
  console.log(`  named in prose only    ${proseOnly.size}`);
  console.log(`  requirement coverage   ${covered.size}/${spec.requirements.size}`);
  console.log(`  in-page anchors        ${links.anchors}`);
  console.log(`  relative links         ${links.paths}`);
  console.log('');

  if (findings.length === 0) {
    console.log('docs: no findings');
    return;
  }

  for (const finding of findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`${finding.file}:${finding.line}: ${finding.message}`);
  }
  console.log('');
  console.log(`docs: ${findings.length} finding(s)`);
  process.exitCode = 1;
}

main();
