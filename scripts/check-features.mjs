#!/usr/bin/env node
/**
 * Validator for the Gherkin specifications in features/.
 *
 * The feature files are specification rather than a suite: nothing runs them,
 * so nothing would otherwise notice a scenario that names a requirement which
 * does not exist, an Examples column no step reads, or a table row that gained
 * a cell. This checks those, and reports which requirements no scenario traces
 * to.
 *
 * `--fix` rewrites misaligned tables. It only ever changes the spaces between
 * the pipes; cell content is never touched.
 *
 * Zero dependencies, run as `npm run check:features`.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FEATURES_DIR = join(REPO_ROOT, 'features');
const SPEC_PATH = join(REPO_ROOT, 'docs', 'reverse-engineer', 'requirements-specification.md');

/**
 * Requirements the feature suite deliberately does not cover, and the reason,
 * as documented in features/README.md. Anything else uncovered is a finding.
 */
const UNCOVERED_BY_DESIGN = new Map([
  ['REQ-139', 'Node.js 22 floor — a property of package.json, verified by Inspection'],
  ['REQ-141', 'build and run-from-source scripts — package.json, verified by Inspection'],
  ['REQ-142', 'the five runtime dependencies — package.json, verified by Inspection'],
  ['REQ-143', 'MIT licensing — LICENSE, verified by Inspection'],
]);

const REQ_TAG = /^@REQ-\d{3}$/;
const REQ_REFERENCE = /@(REQ-\d{3})/g;

const findings = [];

function report(file, line, message) {
  findings.push({ file, line, message });
}

/** Split a Gherkin table row into its cells, honouring the `\|` escape */
function splitRow(text) {
  const cells = [];
  let cell = '';
  let escaped = false;
  // The row is bounded by pipes; everything before the first and after the
  // last is padding rather than a cell.
  const body = text.trim().slice(1, -1);
  for (const char of body) {
    if (escaped) {
      cell += char === '|' ? '\\|' : `\\${char}`;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function formatRow(indent, cells, widths) {
  const padded = cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length));
  return `${indent}| ${padded.join(' | ')} |`.replace(/\s+$/, '');
}

/**
 * One pass over a file, producing everything the checks need. Kept as a single
 * walk because Gherkin's structure is entirely positional: a tag line applies
 * to the next keyword, an Examples header is the first row after the keyword.
 */
function parseFeature(path, text) {
  const lines = text.split('\n');
  const scenarios = [];
  const tables = [];

  let pendingTags = [];
  let featureTags = [];
  let ruleTags = [];
  let rule;
  let scenario;
  let examples;
  let inDocstring = false;
  let docstringOpenedAt;
  let ruleCount = 0;
  let tableBlock;

  const closeTable = () => {
    if (tableBlock) {
      tables.push(tableBlock);
      tableBlock = undefined;
    }
  };

  for (const [index, raw] of lines.entries()) {
    const number = index + 1;
    const trimmed = raw.trim();

    if (raw.includes('\t')) {
      report(path, number, 'tab character; Gherkin indentation is spaces');
    }
    if (/\s$/.test(raw) && raw.trim() !== '') {
      report(path, number, 'trailing whitespace');
    }

    if (trimmed === '"""' || trimmed.startsWith('"""')) {
      if (inDocstring) {
        inDocstring = false;
      } else {
        inDocstring = true;
        docstringOpenedAt = number;
      }
      closeTable();
      scenario?.body.push(raw);
      continue;
    }
    if (inDocstring) {
      scenario?.body.push(raw);
      continue;
    }

    if (trimmed.startsWith('|')) {
      const cells = splitRow(trimmed);
      const indent = raw.slice(0, raw.length - raw.trimStart().length);
      if (!tableBlock) {
        tableBlock = { indent, rows: [], owner: scenario, examples };
      }
      tableBlock.rows.push({ number, raw, cells });
      if (examples && examples.header === undefined) {
        examples.header = cells;
        examples.headerLine = number;
      }
      // A step table belongs to the scenario body; an Examples table holds the
      // values a placeholder is filled from and must not count as a use of it.
      if (!examples) {
        scenario?.body.push(raw);
      }
      continue;
    }
    closeTable();

    if (trimmed === '' || trimmed.startsWith('#')) {
      // A comment between a tag line and its scenario is how a conflict or an
      // amendment is recorded, so it must not clear the pending tags.
      continue;
    }

    if (trimmed.startsWith('@')) {
      pendingTags.push(...trimmed.split(/\s+/).filter((tag) => tag.startsWith('@')));
      continue;
    }

    const keyword = /^(Feature|Rule|Background|Example|Scenario Outline|Scenario Template|Scenario|Examples|Scenarios):/.exec(
      trimmed
    );
    if (!keyword) {
      scenario?.body.push(raw);
      continue;
    }

    const name = trimmed.slice(keyword[0].length).trim();
    switch (keyword[1]) {
      case 'Feature':
        featureTags = pendingTags;
        ruleTags = [];
        scenario = undefined;
        examples = undefined;
        break;
      case 'Rule':
        ruleCount += 1;
        rule = name;
        ruleTags = pendingTags;
        scenario = undefined;
        examples = undefined;
        break;
      case 'Background':
        scenario = undefined;
        examples = undefined;
        break;
      case 'Examples':
      case 'Scenarios':
        // An Examples block carries its own tags: one outline can have a
        // terminal-reachable block and a @code-only one.
        examples = { line: number, tags: pendingTags, header: undefined, headerLine: undefined };
        scenario?.examples.push(examples);
        break;
      default: {
        examples = undefined;
        scenario = {
          file: path,
          line: number,
          name,
          rule,
          outline: keyword[1] === 'Scenario Outline' || keyword[1] === 'Scenario Template',
          tags: [...featureTags, ...ruleTags, ...pendingTags],
          body: [name],
          examples: [],
        };
        scenarios.push(scenario);
      }
    }
    pendingTags = [];
  }

  closeTable();

  if (inDocstring) {
    report(path, docstringOpenedAt, 'unterminated """ docstring');
  }

  return { scenarios, tables, ruleCount };
}

function checkTables(path, tables, fix, edits) {
  for (const block of tables) {
    const width = Math.max(...block.rows.map((row) => row.cells.length));
    for (const row of block.rows) {
      if (row.cells.length !== width) {
        report(
          path,
          row.number,
          `table row has ${row.cells.length} cells; the block has ${width}`
        );
      }
    }

    const widths = [];
    for (const row of block.rows) {
      row.cells.forEach((cell, index) => {
        widths[index] = Math.max(widths[index] ?? 0, cell.length);
      });
    }

    for (const row of block.rows) {
      const wanted = formatRow(block.indent, row.cells, widths);
      if (row.raw === wanted) {
        continue;
      }
      if (fix) {
        edits.set(row.number, wanted);
      } else {
        report(path, row.number, 'table row is not aligned; run with --fix');
      }
    }
  }
}

function checkScenarios(path, scenarios) {
  for (const scenario of scenarios) {
    const requirements = scenario.tags.filter((tag) => REQ_TAG.test(tag));
    if (requirements.length === 0) {
      report(path, scenario.line, `scenario has no @REQ-NNN tag: ${scenario.name}`);
    }

    if (!scenario.outline) {
      continue;
    }
    if (scenario.examples.length === 0) {
      report(path, scenario.line, `Scenario Outline has no Examples: ${scenario.name}`);
      continue;
    }

    // Checked as unused columns rather than unmatched placeholders on purpose:
    // the CLI's own messages contain angle brackets ("-c <chain>"), and those
    // are literal expected text rather than a placeholder.
    const body = scenario.body.join('\n');
    for (const block of scenario.examples) {
      if (block.header === undefined) {
        report(path, block.line, `Examples block has no header row: ${scenario.name}`);
        continue;
      }
      for (const column of block.header) {
        if (column === '') {
          report(path, block.headerLine, `Examples column has no name: ${scenario.name}`);
        } else if (!body.includes(`<${column}>`)) {
          report(
            path,
            block.headerLine,
            `Examples column "${column}" is never used as <${column}>: ${scenario.name}`
          );
        }
      }
    }
  }
}

function definedRequirements() {
  const text = readFileSync(SPEC_PATH, 'utf-8');
  const defined = new Set();
  for (const match of text.matchAll(/^##### (REQ-\d{3}):/gm)) {
    defined.add(match[1]);
  }
  return defined;
}

function main() {
  const fix = process.argv.includes('--fix');
  const files = readdirSync(FEATURES_DIR)
    .filter((name) => name.endsWith('.feature'))
    .sort();

  const defined = definedRequirements();
  const covered = new Map();
  let scenarioCount = 0;
  let ruleCount = 0;
  let conflicts = 0;
  let codeOnly = 0;
  let fixedRows = 0;

  for (const name of files) {
    const path = join(FEATURES_DIR, name);
    const shown = relative(REPO_ROOT, path);
    const text = readFileSync(path, 'utf-8');
    const parsed = parseFeature(shown, text);

    const edits = new Map();
    checkTables(shown, parsed.tables, fix, edits);
    checkScenarios(shown, parsed.scenarios);

    if (edits.size > 0) {
      const lines = text.split('\n');
      for (const [number, replacement] of edits) {
        lines[number - 1] = replacement;
      }
      writeFileSync(path, lines.join('\n'));
      fixedRows += edits.size;
      console.log(`fixed ${edits.size} table row(s) in ${shown}`);
    }

    scenarioCount += parsed.scenarios.length;
    ruleCount += parsed.ruleCount;
    for (const scenario of parsed.scenarios) {
      const tags = [...scenario.tags, ...scenario.examples.flatMap((block) => block.tags)];
      conflicts += tags.filter((tag) => tag === '@conflict').length;
      codeOnly += tags.filter((tag) => tag === '@code-only').length;
      for (const [, requirement] of `${tags.join(' ')} `.matchAll(REQ_REFERENCE)) {
        if (!defined.has(requirement)) {
          report(
            shown,
            scenario.line,
            `@${requirement} is not defined in ${relative(REPO_ROOT, SPEC_PATH)}`
          );
        }
        covered.set(requirement, (covered.get(requirement) ?? 0) + 1);
      }
    }
  }

  const uncovered = [...defined].filter((requirement) => !covered.has(requirement)).sort();
  for (const requirement of uncovered) {
    if (!UNCOVERED_BY_DESIGN.has(requirement)) {
      report(
        relative(REPO_ROOT, SPEC_PATH),
        0,
        `${requirement} has no scenario, and is not one of the four documented in features/README.md`
      );
    }
  }
  for (const [requirement, reason] of UNCOVERED_BY_DESIGN) {
    if (covered.has(requirement)) {
      report(
        relative(REPO_ROOT, SPEC_PATH),
        0,
        `${requirement} now has a scenario but is still listed as absent by design (${reason})`
      );
    }
  }

  const coveredCount = [...covered.keys()].filter((requirement) => defined.has(requirement)).length;

  console.log('');
  console.log(`  files                  ${files.length}`);
  console.log(`  rules                  ${ruleCount}`);
  console.log(`  scenarios              ${scenarioCount}`);
  console.log(`  @conflict              ${conflicts}`);
  console.log(`  @code-only             ${codeOnly}`);
  console.log(`  requirement coverage   ${coveredCount}/${defined.size}`);
  console.log(
    `  uncovered              ${uncovered.length === 0 ? 'none' : uncovered.join(', ')}`
  );
  if (fixedRows > 0) {
    console.log(`  table rows realigned   ${fixedRows}`);
  }
  console.log('');

  if (findings.length === 0) {
    console.log('features: no findings');
    return;
  }

  for (const finding of findings.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line
  )) {
    console.log(`${finding.file}:${finding.line}: ${finding.message}`);
  }
  console.log('');
  console.log(`features: ${findings.length} finding(s)`);
  process.exitCode = 1;
}

main();
