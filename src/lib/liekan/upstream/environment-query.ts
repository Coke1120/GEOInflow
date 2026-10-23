const environmentColumns = new Set(['browser', 'os', 'device', 'screen', 'language']);

/** Event snapshots preserve the selected window, including unknown historical environments. */
export function postgresEventEnvironmentColumn(name: string) {
  return environmentColumns.has(name) ? `website_event.liekan_${name}` : name;
}
