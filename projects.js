async function loadProject(path) {
  const url = new URL(path, import.meta.url);
  url.search = new URL(import.meta.url).search;
  return (await import(url.href)).default;
}

// Add a project's config here once its boundary files are available.
export const PROJECTS = await Promise.all([
  loadProject('./projects/qld-federal-2026/config.js'),
  loadProject('./projects/sa-federal-2026/config.js'),
]);
export const DEFAULT_PROJECT_ID = 'qld-federal-2026';
