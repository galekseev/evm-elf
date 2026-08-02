/**
 * Unit: the two guards on what a profile name may be and what a failed write
 * may say.
 *
 * A profile name becomes a path inside the profiles directory, so the pattern
 * is a security boundary rather than a nicety. And a refused write must name
 * the profile rather than the temporary file the atomic write happened to fail
 * on, which no longer exists by the time anyone reads the message.
 */

import { describe, expect, it } from 'vitest';
import { permissionFailure } from '../../src/lib/fs-errors.js';
import { assertProfileName } from '../../src/lib/profiles.js';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: operation failed, open '/tmp/x.1234.tmp'`), { code });
}

describe('assertProfileName', () => {
  it.each(['default', 'work', 'a', 'ci-2', 'team.staging', 'snake_case', '0'])(
    'accepts %s',
    (name) => {
      expect(() => assertProfileName(name)).not.toThrow();
    }
  );

  it.each([
    ['a slash, which would leave the profiles directory', 'team/work'],
    ['a parent reference', '../../etc/passwd'],
    ['an absolute path', '/etc/passwd'],
    ['a leading dot, which would hide the file', '.hidden'],
    ['a leading dash, which a shell would read as an option', '-force'],
    ['an empty name', ''],
    ['a space', 'my profile'],
  ])('refuses %s', (_why, name) => {
    expect(() => assertProfileName(name)).toThrow(
      `Invalid profile name '${name}': use letters, digits, '.', '_' or '-'`
    );
  });
});

describe('permissionFailure', () => {
  it.each(['EACCES', 'EPERM', 'EROFS'])(
    'turns %s into a message naming the profile and the directory to look at',
    (code) => {
      const error = permissionFailure(errno(code), '/home/me/.config/evm-elf/profiles/work.yaml', 'write');

      expect(error.message).toBe(
        'Could not write /home/me/.config/evm-elf/profiles/work.yaml: permission denied. Nothing written.\n' +
          'Check the directory: ls -ld /home/me/.config/evm-elf/profiles'
      );
    }
  );

  it('says removed rather than written for a refused delete', () => {
    const error = permissionFailure(errno('EACCES'), '/profiles/work.yaml', 'remove');

    expect(error.message).toContain('Could not remove /profiles/work.yaml');
    expect(error.message).toContain('Nothing removed.');
  });

  it('passes a failure that is not about permissions through untouched', () => {
    const original = errno('ENOSPC');

    expect(permissionFailure(original, '/profiles/work.yaml', 'write')).toBe(original);
  });

  it('passes an error with no code through untouched', () => {
    const original = new Error('something else went wrong');

    expect(permissionFailure(original, '/profiles/work.yaml', 'write')).toBe(original);
  });
});
