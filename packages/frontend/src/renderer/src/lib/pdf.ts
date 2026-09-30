/**
 * Export the page as a PDF, through Electron's own printing: the PDF is the
 * page itself under the print styles in index.css, so it matches the screen
 * without a second layout.
 *
 * For the length of the render the page is put in its print state. The theme
 * goes light (a dark PDF wastes ink and reads badly on paper), and lazy
 * images are loaded, because a photo below the fold has not been fetched and
 * would print blank.
 */
export async function exportPdf(fileName: string): Promise<string | null> {
  const root = document.documentElement;
  const theme = root.getAttribute("data-theme");
  let pdf: Uint8Array;
  root.setAttribute("data-theme", "light");
  root.classList.add("printing");
  try {
    const images = [...document.querySelectorAll<HTMLImageElement>(".page-body img")];
    for (const img of images) img.loading = "eager";
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    // Let the theme and the print-only layout settle before rendering.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    pdf = await window.canopyWindow.renderPdf();
  } finally {
    // Back to normal before the save dialog, which can stay open a while.
    root.setAttribute("data-theme", theme ?? "dark");
    root.classList.remove("printing");
  }
  return window.canopyWindow.savePdf(fileName, pdf);
}
