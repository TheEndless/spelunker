import { describe, expect, it } from 'vitest';
import type { ErrorRow } from './types';
import { MAX_SHOWN, errorsHeader, formatErrorsForCopy, reasonFor, visibleErrors } from './errorsList';

const makeErrors = (count: number): ErrorRow[] =>
  Array.from({ length: count }, (_, index) => ({ path: `C:\\folder\\file${index}.txt`, message: `reason ${index}` }));

describe('visibleErrors', () => {
  it('shows everything and hides nothing when under the limit', () => {
    const errors = makeErrors(3);
    expect(visibleErrors(errors)).toEqual({ shown: errors, hidden: 0 });
  });

  it('shows everything and hides nothing when exactly at the limit', () => {
    const errors = makeErrors(MAX_SHOWN);
    const result = visibleErrors(errors);
    expect(result.shown).toHaveLength(MAX_SHOWN);
    expect(result.hidden).toBe(0);
  });

  it('shows only the first MAX_SHOWN rows and counts the rest as hidden', () => {
    const errors = makeErrors(MAX_SHOWN + 5);
    const result = visibleErrors(errors);
    expect(result.shown).toEqual(errors.slice(0, MAX_SHOWN));
    expect(result.hidden).toBe(5);
  });

  it('handles an empty list', () => {
    expect(visibleErrors([])).toEqual({ shown: [], hidden: 0 });
  });

  it('uses 200 as the limit', () => {
    expect(MAX_SHOWN).toBe(200);
  });
});

describe('errorsHeader', () => {
  it('uses the singular form for exactly one error', () => {
    expect(errorsHeader(1)).toBe('1 file or folder could not be read');
  });

  it('uses the plural form for zero and for many', () => {
    expect(errorsHeader(0)).toBe('0 files and folders could not be read');
    expect(errorsHeader(3)).toBe('3 files and folders could not be read');
  });
});

describe('formatErrorsForCopy', () => {
  it('starts with the plural header and lists one error per line', () => {
    const errors: ErrorRow[] = [
      { path: 'C:\\a.txt', message: 'Access is denied' },
      { path: 'C:\\b.txt', message: 'File is in use' },
      { path: 'C:\\c.txt', message: 'Access is denied' },
    ];
    expect(formatErrorsForCopy(errors)).toBe(
      [
        '3 files and folders could not be read',
        'C:\\a.txt\tAccess is denied',
        'C:\\b.txt\tFile is in use',
        'C:\\c.txt\tAccess is denied',
      ].join('\n'),
    );
  });

  it('uses the singular header for one error', () => {
    expect(formatErrorsForCopy([{ path: 'C:\\a.txt', message: 'Denied' }])).toBe(
      '1 file or folder could not be read\nC:\\a.txt\tDenied',
    );
  });

  it('separates path and message with a tab character', () => {
    const lines = formatErrorsForCopy([{ path: 'C:\\a.txt', message: 'Denied' }]).split('\n');
    expect(lines[1].split('\t')).toEqual(['C:\\a.txt', 'Denied']);
  });

  it('includes every error, not only the shown ones', () => {
    const errors = makeErrors(MAX_SHOWN + 10);
    const lines = formatErrorsForCopy(errors).split('\n');
    expect(lines).toHaveLength(errors.length + 1);
    expect(lines[lines.length - 1]).toBe(`C:\\folder\\file${MAX_SHOWN + 9}.txt\treason ${MAX_SHOWN + 9}`);
  });

  it('returns only the header for an empty list', () => {
    expect(formatErrorsForCopy([])).toBe('0 files and folders could not be read');
  });
});

describe('reasonFor', () => {
  it('drops the path the operating system repeats at the start of its message', () => {
    expect(reasonFor({ path: 'C:\Windows\WUModels', message: 'C:\Windows\WUModels: Access is denied. (os error 5)' })).toBe(
      'Access is denied. (os error 5)',
    );
  });

  it('leaves a message alone when it does not start with the path', () => {
    expect(reasonFor({ path: 'C:\a', message: 'The file is in use.' })).toBe('The file is in use.');
  });

  it('does not strip a path that only appears later in the message', () => {
    expect(reasonFor({ path: 'C:\a', message: 'Could not read C:\a: denied' })).toBe('Could not read C:\a: denied');
  });

  it('keeps the whole message when removing the path would leave nothing', () => {
    expect(reasonFor({ path: 'C:\a', message: 'C:\a: ' })).toBe('C:\a: ');
  });
});
