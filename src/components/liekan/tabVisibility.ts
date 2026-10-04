// Move the selected tab inside its strip without scrolling the page or moving focus.
export function keepActiveTabVisible(strip: HTMLElement | null) {
  const active = strip?.querySelector<HTMLElement>('[aria-selected="true"]');
  if (!strip || !active || strip.clientWidth <= 0) return;
  const bounds = strip.getBoundingClientRect();
  const selected = active.getBoundingClientRect();
  if (selected.left < bounds.left) strip.scrollLeft -= bounds.left - selected.left;
  else if (selected.right > bounds.right) strip.scrollLeft += selected.right - bounds.right;
}

export function observeActiveTab(strip: HTMLElement | null) {
  if (!strip) return;
  keepActiveTabVisible(strip);
  const observer = new ResizeObserver(() => keepActiveTabVisible(strip));
  observer.observe(strip);
  return () => observer.disconnect();
}
