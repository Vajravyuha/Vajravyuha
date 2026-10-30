export const REPO_PATTERN = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\.git)?$/;
export const APP_PATTERN = /^[a-z0-9-]{2,40}$/;

export function repoError(value) {
  if (!value.trim()) return 'Repository URL is required.';
  if (!REPO_PATTERN.test(value.trim())) return 'Use https://github.com/owner/repo.';
  return '';
}

export function appError(value) {
  if (!value) return 'Application name is required.';
  if (!APP_PATTERN.test(value)) return 'Use 2–40 lowercase letters, numbers, or hyphens.';
  return '';
}

export function repoName(url) {
  const match = url.trim().match(/^https:\/\/github\.com\/[\w.-]+\/([\w.-]+?)(?:\.git)?$/);
  return match ? match[1].toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) : '';
}
