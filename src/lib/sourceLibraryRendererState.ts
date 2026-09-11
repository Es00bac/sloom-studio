export function buildSourceLibraryRendererItemIds(items: ReadonlyArray<{ id: string }>): string {
  return items
    .map((item) => item.id.trim())
    .filter(Boolean)
    .map((id) => encodeURIComponent(id))
    .join(' ');
}
