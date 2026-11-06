/** Return focus when local search is cancelled, without intercepting results. */
export function startSearchFocus(): () => void {
  let origin: HTMLElement | null = null;
  let frame = 0;
  const remember = () => {
    origin =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
  };
  const restore = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (document.querySelector(".VPLocalSearchBox")) return;
      const target = origin?.isConnected
        ? origin
        : document.querySelector<HTMLElement>(".VPNavBarSearch button");
      target?.focus({ preventScroll: true });
    });
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === "Escape" && document.querySelector(".VPLocalSearchBox"))
      restore();
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")
      remember();
    if (
      event.key === "/" &&
      !(
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable=true]")
      )
    )
      remember();
  };
  const click = (event: MouseEvent) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(".DocSearch-Button")) remember();
    if (
      event.target.closest(
        ".VPLocalSearchBox .backdrop, .VPLocalSearchBox .back-button",
      )
    )
      restore();
  };
  document.addEventListener("keydown", keydown, true);
  document.addEventListener("click", click, true);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("keydown", keydown, true);
    document.removeEventListener("click", click, true);
  };
}
