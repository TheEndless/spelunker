import { DEFAULT_CRITERIA, type Criteria } from './criteria';
import { emptyDateFilter, emptySizeFilter } from './filters';

/**
 * A ready-made search shown on the welcome screen. Choosing one fills the fields (it does not
 * start the search), so a first-time user sees how the name patterns, the text box, and the
 * filters are used.
 */
export interface Recipe {
  title: string;
  /** What the fields will hold, in words. */
  detail: string;
  /** The criteria to fill in. Look in is kept from the current criteria. */
  fill: Partial<Criteria>;
}

export const RECIPES: Recipe[] = [
  {
    title: 'Notes left in code',
    detail: 'Source files containing the whole word TODO',
    fill: { namePatterns: '*.rs; *.ts; *.py; *.js; *.cs', text: 'TODO', wholeWord: true },
  },
  {
    title: 'Documents changed this week',
    detail: 'Office files and PDFs modified in the last 7 days',
    fill: {
      namePatterns: '*.docx; *.xlsx; *.pptx; *.pdf; *.md',
      modified: { ...emptyDateFilter(), mode: 'within', amount: '7', unit: 'days' },
    },
  },
  {
    title: 'What is taking up space',
    detail: 'Any file larger than 100 MB',
    fill: { size: { ...emptySizeFilter(), mode: 'larger', value: '100', unit: 'MB' } },
  },
];

/** Fresh criteria with the recipe filled in and only the folder carried over. */
export function applyRecipe(current: Criteria, recipe: Recipe): Criteria {
  return {
    ...DEFAULT_CRITERIA,
    size: emptySizeFilter(),
    modified: emptyDateFilter(),
    created: emptyDateFilter(),
    ...recipe.fill,
    lookIn: current.lookIn,
  };
}
