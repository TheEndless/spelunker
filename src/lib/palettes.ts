import { bestTextOn, contrast, ensureContrast, mix, normalizeHex } from './colors';

export const TOKEN_NAMES = [
  'bg',
  'surface',
  'surface-raised',
  'text',
  'text-muted',
  'border',
  'border-strong',
  'accent',
  'accent-hover',
  'on-accent',
  'focus-ring',
  'row-hover',
  'row-selected',
  'row-selected-edge',
  'match-bg',
  'match-text',
  'context-text',
  'disabled-bg',
  'disabled-text',
  'danger',
  'header-bg',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];
export type Tokens = Record<TokenName, string>;
export type Mode = 'light' | 'dark';

export interface Palette {
  id: string;
  label: string;
  group: 'spelunker' | 'editor';
  /** What each version is called, for example Catppuccin's Latte and Mocha. */
  names: { light: string; dark: string };
  /** Every theme has both. A theme with only one mode is not offered. */
  light: Tokens;
  dark: Tokens;
}

/** Pairs that must stay readable in every theme and mode. */
export const CONTRAST_CHECKS: {
  foreground: TokenName;
  background: TokenName;
  minimum: number;
  label: string;
}[] = [
  { foreground: 'text', background: 'bg', minimum: 4.5, label: 'body text on the page' },
  { foreground: 'text', background: 'surface', minimum: 4.5, label: 'text on a surface' },
  { foreground: 'text-muted', background: 'surface', minimum: 4.5, label: 'muted text on a surface' },
  { foreground: 'text-muted', background: 'bg', minimum: 4.5, label: 'muted text on the page' },
  { foreground: 'text-muted', background: 'header-bg', minimum: 4.5, label: 'muted text on a header' },
  { foreground: 'on-accent', background: 'accent', minimum: 4.5, label: 'a button label' },
  { foreground: 'on-accent', background: 'accent-hover', minimum: 4.5, label: 'a hovered button label' },
  { foreground: 'match-text', background: 'match-bg', minimum: 7, label: 'a highlighted match' },
  { foreground: 'text', background: 'row-selected', minimum: 7, label: 'text in a selected row' },
  { foreground: 'text-muted', background: 'row-selected', minimum: 4.5, label: 'muted text in a selected row' },
  { foreground: 'danger', background: 'surface', minimum: 4.5, label: 'error text' },
  { foreground: 'accent', background: 'surface', minimum: 3, label: 'the accent as a UI mark' },
  { foreground: 'disabled-text', background: 'disabled-bg', minimum: 3, label: 'a disabled label' },
  { foreground: 'context-text', background: 'surface', minimum: 4.5, label: 'preview context lines' },
];

/**
 * The accent, nudged just far enough to be read as TEXT (4.5:1) on every surface it appears on:
 * rows, selected rows, headers, and raised panels. The plain accent only has to work as a mark.
 */
export function accentTextFor(tokens: Tokens): string {
  return ensureContrast(
    tokens.accent,
    [tokens.surface, tokens['row-hover'], tokens['row-selected'], tokens['header-bg'], tokens['surface-raised']],
    4.5,
  );
}

/**
 * The color of hint text inside an empty field: the muted text color faded toward the field's own
 * background, so a hint reads as a suggestion and not as something typed. It never drops below 3:1,
 * the floor for text that is only an aid.
 */
export function placeholderColorFor(tokens: Tokens): string {
  return ensureContrast(mix(tokens['text-muted'], tokens.surface, 0.4), [tokens.surface], 3);
}

/** The handful of colors a theme author picks. Everything else is derived from these. */
export interface Seed {
  mode: Mode;
  /** The window background behind panels. */
  page: string;
  /** Lists and the preview. */
  surface: string;
  /** The search bar. */
  raised: string;
  text: string;
  muted: string;
  border: string;
  accent: string;
  danger: string;
  /** Selected row. Derived from the accent when omitted. */
  selection?: string;
}

/**
 * The color behind found text: the theme's accent tinted into its surface, so a match is blue in a
 * blue theme and orange in an orange one, and still stands apart from a selected row, which is a
 * weaker tint of the same accent. The text on it must reach 7:1, so if the strongest text cannot,
 * the tint itself is deepened.
 */
export function accentHighlight(surface: string, accent: string, text: string, dark: boolean): { background: string; text: string } {
  const tint = mix(surface, accent, dark ? ACCENT_SHARE_IN_HIGHLIGHT.dark : ACCENT_SHARE_IN_HIGHLIGHT.light);
  const matchText = ensureContrast(text, [tint], 7);
  return { background: ensureContrast(tint, [matchText], 7), text: matchText };
}

/** How much of the accent a highlight holds: more than a selected row (0.16 light, 0.24 dark) so the two differ. */
const ACCENT_SHARE_IN_HIGHLIGHT = { light: 0.42, dark: 0.5 };

/**
 * Completes a seed into every token. Where a seed color would not be readable (Solarized's
 * body text is the classic case), it is moved toward black or white by the least amount that
 * passes, so the theme keeps its character without failing the contrast checks.
 */
export function tokensFromSeed(seed: Seed): Tokens {
  const dark = seed.mode === 'dark';
  const page = normalizeHex(seed.page);
  const surface = normalizeHex(seed.surface);
  const raised = normalizeHex(seed.raised);
  const header = mix(page, surface, 0.35);

  let accent = ensureContrast(seed.accent, [surface], 3);
  const onAccent = bestTextOn(accent);
  const adjusted = ensureContrast(accent, [onAccent], 4.5);
  if (contrast(adjusted, surface) >= 3) accent = adjusted;
  // Hover moves away from the label color so the label stays readable: a light label wants a
  // darker accent, a dark label wants a lighter one.
  const labelIsLight = onAccent === '#FFFFFF';
  const accentHover = ensureContrast(
    mix(accent, labelIsLight ? '#000000' : '#FFFFFF', 0.14),
    [onAccent],
    4.5,
  );

  // The selected row must stay dark enough (or light enough) that text can reach 7:1 on it.
  const strongestText = dark ? '#FFFFFF' : '#000000';
  const selected = ensureContrast(
    seed.selection ? normalizeHex(seed.selection) : mix(surface, accent, dark ? 0.24 : 0.16),
    [strongestText],
    7.6,
  );
  const surfaces = [page, surface, raised, header, selected];
  const text = ensureContrast(seed.text, surfaces, 7.2);
  const muted = ensureContrast(seed.muted, surfaces, 4.5);
  const highlight = accentHighlight(surface, accent, text, dark);
  const disabledBackground = mix(surface, text, 0.08);

  return {
    bg: page,
    surface,
    'surface-raised': raised,
    text,
    'text-muted': muted,
    border: normalizeHex(seed.border),
    'border-strong': mix(seed.border, text, 0.3),
    accent,
    'accent-hover': accentHover,
    'on-accent': normalizeHex(onAccent),
    'focus-ring': accent,
    'row-hover': mix(surface, text, 0.05),
    'row-selected': selected,
    'row-selected-edge': accent,
    'match-bg': highlight.background,
    'match-text': highlight.text,
    'context-text': muted,
    'disabled-bg': disabledBackground,
    'disabled-text': ensureContrast(mix(text, surface, 0.5), [disabledBackground], 3),
    danger: ensureContrast(seed.danger, [page, surface, raised], 4.5),
    'header-bg': header,
  };
}

/** A theme written out token by token. Its highlight is not: it is derived from the accent like every other theme's. */
function explicit(values: Omit<Tokens, 'match-bg' | 'match-text'>): Tokens {
  const given = Object.fromEntries(TOKEN_NAMES.filter((name) => name in values).map((name) => [name, normalizeHex(values[name as keyof typeof values])]));
  const tokens = given as Omit<Tokens, 'match-bg' | 'match-text'>;
  const dark = contrast('#FFFFFF', tokens.surface) > contrast('#000000', tokens.surface);
  const highlight = accentHighlight(tokens.surface, tokens.accent, tokens.text, dark);
  return { ...tokens, 'match-bg': highlight.background, 'match-text': highlight.text };
}

const SLATE: Palette = {
  id: 'slate',
  label: 'Slate',
  group: 'spelunker',
  names: { light: 'Light', dark: 'Dark' },
  light: explicit({
    bg: '#F3F4F6', surface: '#FFFFFF', 'surface-raised': '#FAFAFB', text: '#1D2229', 'text-muted': '#5A6573',
    border: '#D5DAE1', 'border-strong': '#B9C0CA', accent: '#A85A00', 'accent-hover': '#8F4C00', 'on-accent': '#FFFFFF',
    'focus-ring': '#1A6FD6', 'row-hover': '#F1F3F6', 'row-selected': '#FBE9C6', 'row-selected-edge': '#A85A00', 'context-text': '#5A6573', 'disabled-bg': '#E6E9EE',
    'disabled-text': '#6E7886', danger: '#B3261E', 'header-bg': '#ECEEF2',
  }),
  dark: explicit({
    bg: '#12151A', surface: '#191D23', 'surface-raised': '#20252D', text: '#E4E8EE', 'text-muted': '#98A2B1',
    border: '#2D343E', 'border-strong': '#414A57', accent: '#F2A33A', 'accent-hover': '#FFB85C', 'on-accent': '#1B1204',
    'focus-ring': '#6AA9FF', 'row-hover': '#212630', 'row-selected': '#3A2E14', 'row-selected-edge': '#F2A33A', 'context-text': '#8993A3', 'disabled-bg': '#262B33',
    'disabled-text': '#758091', danger: '#FF8A80', 'header-bg': '#1E232B',
  }),
};

const GEODE: Palette = {
  id: 'geode',
  label: 'Geode',
  group: 'spelunker',
  names: { light: 'Light', dark: 'Dark' },
  light: explicit({
    bg: '#EFEDF4', surface: '#FFFFFF', 'surface-raised': '#F8F7FB', text: '#1E1A2B', 'text-muted': '#5C5671',
    border: '#DAD6E6', 'border-strong': '#BAB3CF', accent: '#5B3FBF', 'accent-hover': '#4A31A3', 'on-accent': '#FFFFFF',
    'focus-ring': '#7A5CE0', 'row-hover': '#F3F1F9', 'row-selected': '#E4DCFA', 'row-selected-edge': '#5B3FBF', 'context-text': '#5C5671', 'disabled-bg': '#E7E4EE',
    'disabled-text': '#7A748F', danger: '#B3261E', 'header-bg': '#E9E6F1',
  }),
  dark: explicit({
    bg: '#15111D', surface: '#1C1727', 'surface-raised': '#241E31', text: '#ECE8F5', 'text-muted': '#A8A2BB',
    border: '#31293F', 'border-strong': '#483E5D', accent: '#B79CFF', 'accent-hover': '#CDB8FF', 'on-accent': '#1A1230',
    'focus-ring': '#C9B6FF', 'row-hover': '#251F33', 'row-selected': '#372A52', 'row-selected-edge': '#B79CFF', 'context-text': '#9F99B3', 'disabled-bg': '#2A2338',
    'disabled-text': '#7A7391', danger: '#FF8A80', 'header-bg': '#211B2D',
  }),
};

const VERDIGRIS: Palette = {
  id: 'verdigris',
  label: 'Verdigris',
  group: 'spelunker',
  names: { light: 'Light', dark: 'Dark' },
  light: explicit({
    bg: '#EAF0EE', surface: '#FFFFFF', 'surface-raised': '#F5F9F8', text: '#14201F', 'text-muted': '#4E605C',
    border: '#D0DCD9', 'border-strong': '#AEC1BC', accent: '#0F766E', 'accent-hover': '#0B5F58', 'on-accent': '#FFFFFF',
    'focus-ring': '#0E8F84', 'row-hover': '#EFF5F3', 'row-selected': '#D3ECE7', 'row-selected-edge': '#0F766E', 'context-text': '#4E605C', 'disabled-bg': '#E0E8E6',
    'disabled-text': '#6F817B', danger: '#B3261E', 'header-bg': '#E3EBE9',
  }),
  dark: explicit({
    bg: '#0E1717', surface: '#131E1E', 'surface-raised': '#192727', text: '#E3EEEC', 'text-muted': '#93A9A5',
    border: '#243534', 'border-strong': '#35504E', accent: '#4FC3B2', 'accent-hover': '#7AD8CA', 'on-accent': '#07201C',
    'focus-ring': '#7AD8CA', 'row-hover': '#1A2828', 'row-selected': '#1D3B38', 'row-selected-edge': '#4FC3B2', 'context-text': '#819994', 'disabled-bg': '#1E2D2D',
    'disabled-text': '#668480', danger: '#FF8A80', 'header-bg': '#162424',
  }),
};

const BASALT: Palette = {
  id: 'basalt',
  label: 'Basalt',
  group: 'spelunker',
  names: { light: 'Light', dark: 'Dark' },
  light: explicit({
    bg: '#EEECE8', surface: '#FFFFFF', 'surface-raised': '#F8F7F4', text: '#201C17', 'text-muted': '#605850',
    border: '#DAD5CC', 'border-strong': '#BDB5A9', accent: '#9A5200', 'accent-hover': '#7F4300', 'on-accent': '#FFFFFF',
    'focus-ring': '#C26A00', 'row-hover': '#F4F2EE', 'row-selected': '#F6E3C4', 'row-selected-edge': '#9A5200', 'context-text': '#605850', 'disabled-bg': '#E6E2DB',
    'disabled-text': '#7B7368', danger: '#B3261E', 'header-bg': '#E8E5DF',
  }),
  dark: explicit({
    bg: '#171411', surface: '#1E1A16', 'surface-raised': '#27221D', text: '#EEE8DF', 'text-muted': '#A89F92',
    border: '#332D26', 'border-strong': '#4A4137', accent: '#EDA640', 'accent-hover': '#FFBE5C', 'on-accent': '#1F1404',
    'focus-ring': '#FFBE5C', 'row-hover': '#26211B', 'row-selected': '#40301A', 'row-selected-edge': '#EDA640', 'context-text': '#9B9286', 'disabled-bg': '#2B2620',
    'disabled-text': '#81786B', danger: '#FF8A80', 'header-bg': '#221E19',
  }),
};

const SOLARIZED: Palette = {
  id: 'solarized',
  label: 'Solarized',
  group: 'editor',
  names: { light: 'Solarized Light', dark: 'Solarized Dark' },
  light: tokensFromSeed({
    mode: 'light', page: '#EEE8D5', surface: '#FDF6E3', raised: '#F7F0DC', text: '#586E75', muted: '#93A1A1',
    border: '#E2DAC3', accent: '#268BD2', danger: '#DC322F',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#002B36', surface: '#073642', raised: '#0A3E4B', text: '#93A1A1', muted: '#657B83',
    border: '#15505F', accent: '#268BD2', danger: '#DC322F',
  }),
};

const GITHUB: Palette = {
  id: 'github',
  label: 'GitHub',
  group: 'editor',
  names: { light: 'GitHub Light', dark: 'GitHub Dark' },
  light: tokensFromSeed({
    mode: 'light', page: '#F6F8FA', surface: '#FFFFFF', raised: '#F6F8FA', text: '#1F2328', muted: '#59636E',
    border: '#D1D9E0', accent: '#0969DA', danger: '#CF222E', selection: '#DDF4FF',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#010409', surface: '#0D1117', raised: '#151B23', text: '#E6EDF3', muted: '#9198A1',
    border: '#3D444D', accent: '#4493F8', danger: '#F85149',
  }),
};

const ONE: Palette = {
  id: 'one',
  label: 'One',
  group: 'editor',
  names: { light: 'One Light', dark: 'One Dark' },
  light: tokensFromSeed({
    mode: 'light', page: '#EAEAEB', surface: '#FAFAFA', raised: '#F2F2F3', text: '#383A42', muted: '#696C77',
    border: '#DBDBDC', accent: '#4078F2', danger: '#E45649',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#21252B', surface: '#282C34', raised: '#2C313A', text: '#ABB2BF', muted: '#7F848E',
    border: '#3B4048', accent: '#61AFEF', danger: '#E06C75', selection: '#3E4451',
  }),
};

const NORD: Palette = {
  id: 'nord',
  label: 'Nord',
  group: 'editor',
  names: { light: 'Snow Storm', dark: 'Polar Night' },
  light: tokensFromSeed({
    mode: 'light', page: '#D8DEE9', surface: '#ECEFF4', raised: '#F4F6FA', text: '#2E3440', muted: '#4C566A',
    border: '#D0D6E2', accent: '#5E81AC', danger: '#BF616A',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#2E3440', surface: '#3B4252', raised: '#434C5E', text: '#D8DEE9', muted: '#4C566A',
    border: '#4C566A', accent: '#88C0D0', danger: '#BF616A',
  }),
};

const GRUVBOX: Palette = {
  id: 'gruvbox',
  label: 'Gruvbox',
  group: 'editor',
  names: { light: 'Gruvbox Light', dark: 'Gruvbox Dark' },
  light: tokensFromSeed({
    mode: 'light', page: '#F2E5BC', surface: '#FBF1C7', raised: '#FCF4D3', text: '#3C3836', muted: '#7C6F64',
    border: '#EBDBB2', accent: '#AF3A03', danger: '#9D0006',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#1D2021', surface: '#282828', raised: '#32302F', text: '#EBDBB2', muted: '#A89984',
    border: '#3C3836', accent: '#FABD2F', danger: '#FB4934', selection: '#504945',
  }),
};

const CATPPUCCIN: Palette = {
  id: 'catppuccin',
  label: 'Catppuccin',
  group: 'editor',
  names: { light: 'Latte', dark: 'Mocha' },
  light: tokensFromSeed({
    mode: 'light', page: '#E6E9EF', surface: '#EFF1F5', raised: '#F5F6F9', text: '#4C4F69', muted: '#6C6F85',
    border: '#CCD0DA', accent: '#8839EF', danger: '#D20F39',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#11111B', surface: '#1E1E2E', raised: '#272839', text: '#CDD6F4', muted: '#A6ADC8',
    border: '#313244', accent: '#CBA6F7', danger: '#F38BA8',
  }),
};

const TOKYO_NIGHT: Palette = {
  id: 'tokyo-night',
  label: 'Tokyo Night',
  group: 'editor',
  names: { light: 'Day', dark: 'Night' },
  light: tokensFromSeed({
    mode: 'light', page: '#D0D5E3', surface: '#E1E2E7', raised: '#E9EAEE', text: '#3760BF', muted: '#6172B0',
    border: '#C4C8DA', accent: '#2E7DE9', danger: '#F52A65',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#16161E', surface: '#1A1B26', raised: '#1F2335', text: '#C0CAF5', muted: '#A9B1D6',
    border: '#292E42', accent: '#7AA2F7', danger: '#F7768E', selection: '#283457',
  }),
};

const DRACULA: Palette = {
  id: 'dracula',
  label: 'Dracula',
  group: 'editor',
  names: { light: 'Alucard', dark: 'Dracula' },
  light: tokensFromSeed({
    mode: 'light', page: '#F4EFDC', surface: '#FFFBEB', raised: '#FAF4E0', text: '#1F1F1F', muted: '#6C664B',
    border: '#DDD6BD', accent: '#644AC9', danger: '#CB3A2A', selection: '#CFCFDE',
  }),
  dark: tokensFromSeed({
    mode: 'dark', page: '#21222C', surface: '#282A36', raised: '#313343', text: '#F8F8F2', muted: '#6272A4',
    border: '#44475A', accent: '#BD93F9', danger: '#FF5555', selection: '#44475A',
  }),
};

export const PALETTES: Palette[] = [
  SLATE, GEODE, VERDIGRIS, BASALT,
  SOLARIZED, GITHUB, ONE, NORD, GRUVBOX, CATPPUCCIN, TOKYO_NIGHT, DRACULA,
];

/** The palette with this id, or the original slate when the id is unknown (for example a removed theme). */
export function findPalette(id: string): Palette {
  return PALETTES.find((palette) => palette.id === id) ?? PALETTES[0];
}

/** The tokens for `mode` of the palette with this id. Unknown ids use slate. */
export function tokensFor(id: string, mode: Mode): Tokens {
  return findPalette(id)[mode];
}

/**
 * "Latte and Mocha" style text for a theme's two versions. Empty when the names add nothing,
 * which is when they are just Light and Dark or repeat the theme name ("Solarized Light").
 */
export function versionNames(palette: Palette): string {
  const { light, dark } = palette.names;
  const plain = light === 'Light' && dark === 'Dark';
  const repeatsName = light === `${palette.label} Light` && dark === `${palette.label} Dark`;
  return plain || repeatsName ? '' : `${light} and ${dark}`;
}
