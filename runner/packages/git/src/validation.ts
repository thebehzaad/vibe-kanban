/**
 * Branch name validation
 * Translates: crates/git/src/validation.rs
 */

/**
 * Validate if a branch prefix is valid according to Git naming rules.
 * Branch prefix cannot contain '/' and must form a valid branch name when combined with a suffix.
 * 
 * @param prefix The branch prefix to validate
 * @returns true if the prefix is valid, false otherwise
 */
export function isValidBranchPrefix(prefix: string): boolean {
  if (prefix === '') {
    return true;
  }

  // Prefixes cannot contain slashes
  if (prefix.includes('/')) {
    return false;
  }

  // Check if the prefix would form a valid branch name
  // We test with a dummy suffix to validate the full branch name format
  const testBranchName = `${prefix}/x`;
  
  return isValidBranchName(testBranchName);
}

/**
 * Check if a branch name is valid according to Git's rules.
 * 
 * Git branch names must not:
 * - Start with '.' or '/'
 * - End with '/' or '.lock'
 * - Contain '..' or '@{'
 * - Contain special characters: '~', '^', ':', '?', '*', '[', '\\'
 * - Contain spaces
 * - Be a single '@' character
 * 
 * @param name The branch name to validate
 * @returns true if valid, false otherwise
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length === 0) {
    return false;
  }

  // Cannot be just '@'
  if (name === '@') {
    return false;
  }

  // Cannot start with '.' or '/'
  if (name.startsWith('.') || name.startsWith('/')) {
    return false;
  }

  // Cannot end with '/' or '.lock'
  if (name.endsWith('/') || name.endsWith('.lock')) {
    return false;
  }

  // Cannot contain these sequences
  if (name.includes('..') || name.includes('@{')) {
    return false;
  }

  // Cannot contain these characters
  const invalidChars = ['~', '^', ':', '?', '*', '[', '\\', ' '];
  for (const char of invalidChars) {
    if (name.includes(char)) {
      return false;
    }
  }

  // Check for control characters
  if (/[\x00-\x1F\x7F]/.test(name)) {
    return false;
  }

  return true;
}
