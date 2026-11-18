// Phones: stacked table cards show each value with its column name (CSS reads td[data-label]).
// One observer labels every table.stack-table in the app as rows render.
let queued = false;
function label() {
  queued = false;
  // REQ-146: on phones every content table becomes cards (opt out: .keep-table / role=grid calendars)
  document
    .querySelectorAll("main table:not(.stack-table):not(.keep-table):not([role=grid])")
    .forEach((t) => t.classList.add("stack-table"));
  document.querySelectorAll("table.stack-table").forEach((t) => {
    const heads = [...t.querySelectorAll("thead th")].map((th) => th.textContent.trim());
    if (!heads.length) return;
    t.querySelectorAll("tbody tr, tfoot tr").forEach((tr) =>
      [...tr.children].forEach((td, i) => {
        if (td.colSpan > 1) return; // a spanning note row has no single column name
        if (heads[i] && td.getAttribute("data-label") !== heads[i])
          td.setAttribute("data-label", heads[i]);
      }),
    );
  });
}

export function installStackLabels() {
  if (typeof MutationObserver === "undefined") return;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(label);
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
}
