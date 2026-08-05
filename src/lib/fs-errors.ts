/**
 * Turning a filesystem failure into something an operator can act on.
 */

import { dirname } from 'path';

/** The codes that mean "the directory or file will not let you", not "it is not there" */
const DENIED = new Set(['EACCES', 'EPERM', 'EROFS']);

/**
 * A profile operation refused on permissions names the profile it was working
 * on and the directory to look at. Without this the operator is shown whatever
 * path the operation happened to fail on — for a write, the atomic write's
 * temporary file, which no longer exists by the time they read the message.
 *
 * Anything else is passed through: a failure that is not about permissions is
 * better described by the system than by a guess at what it meant.
 */
export function permissionFailure(
  error: unknown,
  targetPath: string,
  action: 'write' | 'remove'
): Error {
  const { code } = error as NodeJS.ErrnoException;
  if (code === undefined || !DENIED.has(code)) {
    return error as Error;
  }
  const outcome = action === 'write' ? 'written' : 'removed';
  return new Error(
    `Could not ${action} ${targetPath}: permission denied. Nothing ${outcome}.\n` +
      `Check the directory: ls -ld ${dirname(targetPath)}`
  );
}
