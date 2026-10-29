/**
 * An invented documents folder, for the browser build's mock backend: typing `invoice` as the text
 * streams these rows, and the README screenshot is taken from them. Every name here is made up
 * (the user is "sam", the clients are the stock fictional companies), so a screenshot of it shows
 * nothing from a real disk. Nothing in it is random at run time: the same moment gives the same rows.
 */
import type { PreviewLine, ResultRow } from './types';

/** The text that selects this fixture in the mock backend. */
export const DEMO_QUERY = 'invoice';

const ROOT = 'C:\\Users\\sam\\Documents';

/** The file whose preview is `demoPreview`. */
export const DEMO_NOTE_PATH = `${ROOT}\\Clients\\Acme\\Correspondence\\invoice-question.eml`;

const MB = 1024 * 1024;
const DAY_MS = 86_400_000;

type Kind = 'pdf' | 'docx' | 'xlsx' | 'md' | 'png' | 'jpg' | 'eml' | 'zip' | 'mp4' | 'pptx' | 'csv' | 'txt';

/** The type name Windows shows, and the size range (log-uniform, in bytes) for each kind of file. */
const KINDS: Record<Kind, { typeName: string; minSize: number; maxSize: number }> = {
  pdf: { typeName: 'PDF Document', minSize: 40 * 1024, maxSize: 3 * MB },
  docx: { typeName: 'Microsoft Word Document', minSize: 12 * 1024, maxSize: 2 * MB },
  xlsx: { typeName: 'Microsoft Excel Worksheet', minSize: 8 * 1024, maxSize: 4 * MB },
  md: { typeName: 'Markdown File', minSize: 1024, maxSize: 40 * 1024 },
  png: { typeName: 'PNG File', minSize: 120 * 1024, maxSize: 5 * MB },
  jpg: { typeName: 'JPEG Image', minSize: 200 * 1024, maxSize: 4 * MB },
  eml: { typeName: 'Outlook Item', minSize: 3 * 1024, maxSize: 80 * 1024 },
  zip: { typeName: 'Compressed (zipped) Folder', minSize: 3 * MB, maxSize: 40 * MB },
  mp4: { typeName: 'MP4 Video', minSize: 20 * MB, maxSize: 55 * MB },
  pptx: { typeName: 'Microsoft PowerPoint Presentation', minSize: 1 * MB, maxSize: 14 * MB },
  csv: { typeName: 'Microsoft Excel Comma Separated Values File', minSize: 4 * 1024, maxSize: 4 * MB },
  txt: { typeName: 'Text Document', minSize: 400, maxSize: 30 * 1024 },
};

const CLIENTS = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli'];
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const TOPICS = ['invoice-question', 'payment-reminder', 'project-kickoff', 'scope-change', 'thank-you'];
const VENDORS = ['cafe', 'office-supplies', 'train', 'hotel', 'software'];

/** A small seeded generator (mulberry32), so the fixture never changes between runs. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

interface Entry {
  folder: string;
  name: string;
  kind: Kind;
  /** Set for the few files whose size is chosen, not drawn. */
  size?: number;
}

function entries(random: () => number): Entry[] {
  const found: Entry[] = [];
  const add = (folder: string, name: string, kind: Kind, size?: number) => found.push({ folder: `${ROOT}\\${folder}`, name, kind, size });

  for (const year of ['2023', '2024', '2025']) {
    for (const client of CLIENTS) {
      for (const month of MONTHS) {
        // Not every client is billed every month.
        if (random() < 0.62) add(`Finance\\Invoices\\${year}`, `invoice-${year}-${month}-${client.toLowerCase()}.pdf`, 'pdf');
      }
    }
  }
  for (const vendor of VENDORS) {
    for (let number = 1; number <= 8; number++) add('Finance\\Receipts\\2024', `receipt-${vendor}-${String(number).padStart(2, '0')}.jpg`, 'jpg');
  }
  for (const quarter of ['q1', 'q2', 'q3', 'q4']) add('Finance\\Tax', `expenses-${quarter}-2024.xlsx`, 'xlsx');
  add('Finance\\Tax', 'tax-summary-2023.xlsx', 'xlsx');
  add('Finance\\Tax', 'invoice-ledger-2024.xlsx', 'xlsx', 2.4 * MB);

  for (const client of CLIENTS) {
    add(`Clients\\${client}\\Contracts`, `${client.toLowerCase()}-services-agreement.docx`, 'docx');
    for (const version of [1, 2, 3]) add(`Clients\\${client}\\Contracts`, `${client.toLowerCase()}-statement-of-work-v${version}.docx`, 'docx');
    for (const topic of TOPICS) {
      for (const copy of [1, 2, 3, 4]) add(`Clients\\${client}\\Correspondence`, `${topic}${copy === 1 ? '' : `-${copy}`}.eml`, 'eml');
    }
    for (let number = 1; number <= 12; number++) add(`Clients\\${client}\\Scans`, `scan-${String(number).padStart(4, '0')}.png`, 'png');
  }

  for (const name of ['billing-notes', 'scope', 'timeline', 'risks', 'meeting-notes']) add('Projects\\site-redesign\\docs', `${name}.md`, 'md');
  add('Projects\\site-redesign\\docs', 'invoice-template.docx', 'docx');
  for (const name of ['billing-flow', 'onboarding', 'release-checklist', 'api-notes']) add('Projects\\mobile-app\\specs', `${name}.md`, 'md');
  for (let number = 1; number <= 18; number++) add('Projects\\mobile-app\\design', `mockup-${String(number).padStart(2, '0')}.png`, 'png');

  for (const quarter of ['q1', 'q2', 'q3', 'q4']) add('Finance\\Exports', `invoices-export-${quarter}-2024.csv`, 'csv');
  for (const client of CLIENTS) add('Finance\\Exports', `invoices-${client.toLowerCase()}-all-time.csv`, 'csv');
  for (const name of ['pricing', 'kickoff-template', 'quarterly-review', 'pitch', 'training']) add('Presentations', `${name}-invoice-process.pptx`, 'pptx');
  for (const name of ['todo', 'phone-numbers', 'invoice-reminders', 'ideas', 'passwords-hint', 'shopping', 'travel']) add('Notes', `${name}.txt`, 'txt');
  for (const quarter of ['2023-q1', '2023-q2', '2023-q3', '2023-q4', '2024-q1']) add('Backups', `invoice-archive-${quarter}.zip`, 'zip');
  for (const month of ['03', '06', '09']) add('Recordings\\Walkthroughs', `billing-walkthrough-2024-${month}.mp4`, 'mp4');
  add('Recordings\\Walkthroughs', 'invoice-system-demo-full.mp4', 'mp4', 70 * MB);

  add('Archive\\2022', 'year-end-report.pdf', 'pdf', 48 * MB);
  add('Archive\\2022', 'scans-2022.pdf', 'pdf', 22 * MB);
  add('Archive\\2022', 'invoice-export-2022.xlsx', 'xlsx', 6.5 * MB);
  for (const month of MONTHS) add('Archive\\2022\\Invoices', `invoice-2022-${month}.pdf`, 'pdf');
  return found;
}

/** The text of the email shown in the preview. */
const NOTE_LINES = [
  'From: Dana Whitfield <dana@acme.example>',
  'To: Sam Rivera <sam@studio.example>',
  'Subject: Question about invoice 2024-0317',
  'Date: Tue, 19 Mar 2024 09:42:11 +0000',
  '',
  'Hi Sam,',
  '',
  'Thanks for sending the March invoice over.',
  'Could you confirm the hours on line 3 of the',
  'invoice? We billed 18 hours, but our timesheet',
  'says 16.',
  '',
  'Once that is settled I will get it approved',
  'for payment. Our terms are net 30, so the money',
  'should reach you before the end of April.',
  '',
  'Thanks,',
  'Dana',
];

/** Every place `needle` occurs in `text`, ignoring case. */
function occurrences(text: string, needle: string): { start: number; end: number }[] {
  const found: { start: number; end: number }[] = [];
  const lower = text.toLowerCase();
  for (let from = lower.indexOf(needle); from >= 0; from = lower.indexOf(needle, from + needle.length)) {
    found.push({ start: from, end: from + needle.length });
  }
  return found;
}

const noteHits = (): number => NOTE_LINES.reduce((sum, line) => sum + occurrences(line, DEMO_QUERY).length, 0);

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' });

/** The rows of the fixture, in the order a search would give them: folder by folder, by name. */
export function demoRows(now = Date.now()): ResultRow[] {
  const random = seeded(20240319);
  const sorted = entries(random)
    .map((entry) => ({ ...entry, path: `${entry.folder}\\${entry.name}` }))
    .sort((left, right) => left.folder.toLowerCase().localeCompare(right.folder.toLowerCase()) || left.name.localeCompare(right.name));
  return sorted.map((entry) => {
    const { typeName, minSize, maxSize } = KINDS[entry.kind];
    const size = entry.size ?? Math.round(minSize * (maxSize / minSize) ** random());
    const modifiedMs = now - Math.round((1 + random() * 880) * DAY_MS);
    const hits = entry.path === DEMO_NOTE_PATH ? noteHits() : 1 + Math.floor(random() ** 2 * 14);
    return { path: entry.path, size: Math.round(size), modifiedMs, modifiedText: DATE_FORMAT.format(modifiedMs), hits, typeName };
  });
}

/** The preview of the demo email: the lines within `contextLines` of a match, with the matches marked. */
export function demoPreview(contextLines: number): PreviewLine[] {
  const matchRanges = NOTE_LINES.map((line) => occurrences(line, DEMO_QUERY));
  const matchLines = matchRanges.flatMap((ranges, index) => (ranges.length > 0 ? [index] : []));
  return NOTE_LINES.flatMap((text, index) => {
    if (!matchLines.some((matchLine) => Math.abs(matchLine - index) <= contextLines)) return [];
    return [{ lineNumber: index + 1, text, isMatch: matchRanges[index].length > 0, matchRanges: matchRanges[index] }];
  });
}
