(() => {
  "use strict";

  const mount = document.querySelector("[data-codex-region-nav]");
  if (!mount || document.getElementById("codex-region-nav-root")) return;

  const regions = readRegions(mount);
  const current = mount.dataset.current || "";
  const currentIndex = regions.findIndex((region) => region.code === current);
  if (currentIndex < 0 || regions.length < 2) return;
  const targets = regions.filter((region) => region.code !== current);

  const storageKey = "codex-omni.region-nav.v2";
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const defaults = { x: 1, y: 0.38, collapsed: false };

  function readRegions(element) {
    try {
      const parsed = JSON.parse(element.dataset.regions || "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (region) =>
            region &&
            typeof region.code === "string" &&
            /^[a-z0-9][a-z0-9_-]{0,31}$/.test(region.code) &&
            typeof region.label === "string"
        )
        .slice(0, 8);
    } catch {
      return [];
    }
  }

  function readState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
        return {
          x: clamp(saved.x, 0, 1),
          y: clamp(saved.y, 0, 1),
          collapsed: saved.collapsed === true,
          icon: typeof saved.icon === "string" ? saved.icon : undefined
        };
      }
    } catch {
      // Storage is optional, including in private browsing.
    }
    return { ...defaults };
  }

  let state = readState();
  function saveState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Keep working without persistence.
    }
  }

  const nav = document.createElement("div");
  nav.id = "codex-region-nav-root";
  nav.setAttribute("role", "group");
  nav.setAttribute("aria-label", "地区切换");
  nav.innerHTML = `
    <div class="codex-region-toolbar">
      <button type="button" class="codex-region-grip" aria-label="拖动地区切换，或用方向键移动" title="拖动地区切换，或用方向键移动">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg>
      </button>
      ${regions
        .map(
          (region) => `
        <a class="codex-region-link" href="/${region.code}/"${region.code === current ? ' aria-current="page"' : ""} aria-label="前往${escapeHtml(region.label)}站点" title="前往${escapeHtml(region.label)}站点 /${region.code}">
          <img src="/${current}/region-nav/icons/${region.code}.svg" alt="" draggable="false">
          <span>${region.code.toUpperCase()}</span>
        </a>`
        )
        .join("")}
      <button type="button" class="codex-region-collapse" aria-label="收起到侧边" title="收起到侧边">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg>
      </button>
    </div>
    <button type="button" class="codex-region-tab" aria-label="展开地区切换" aria-expanded="false" title="展开地区切换（也可拖动）">
      <img src="/${current}/region-nav/icons/${targets[0].code}.svg" alt="" draggable="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg>
    </button>`;
  mount.replaceWith(nav);

  const toolbar = nav.querySelector(".codex-region-toolbar");
  const grip = nav.querySelector(".codex-region-grip");
  const collapse = nav.querySelector(".codex-region-collapse");
  const tab = nav.querySelector(".codex-region-tab");
  const links = [...nav.querySelectorAll(".codex-region-link")];

  let drag = null;
  let press = null;
  let suppressClickUntil = 0;
  let frame = 0;

  function escapeHtml(value) {
    return String(value).replace(
      /[&<>"']/g,
      (character) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
    );
  }

  function bounds() {
    const viewport = window.visualViewport;
    const width = viewport?.width || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const left = viewport?.offsetLeft || 0;
    const top = viewport?.offsetTop || 0;
    const styles = getComputedStyle(nav);
    const safe = (edge) => parseFloat(styles.getPropertyValue(`--codex-region-safe-${edge}`)) || 0;
    const gap = state.collapsed ? 4 : 12;
    const minX = left + safe("left") + gap;
    const minY = top + safe("top") + 12;
    return {
      minX,
      minY,
      maxX: Math.max(minX, left + width - safe("right") - gap - nav.offsetWidth),
      maxY: Math.max(
        minY,
        top + height - Math.max(88, safe("bottom") + 16) - nav.offsetHeight
      )
    };
  }

  function place(x, y) {
    nav.style.left = `${x}px`;
    nav.style.top = `${y}px`;
  }

  function render() {
    toolbar.hidden = state.collapsed;
    tab.hidden = !state.collapsed;
    tab.setAttribute("aria-expanded", String(!state.collapsed));
    nav.dataset.side = state.x < 0.5 ? "left" : "right";
    nav.dataset.collapsed = String(state.collapsed);
    const editable = document.activeElement?.matches(
      'input:not([type="button"]):not([type="submit"]), textarea, [contenteditable="true"]'
    );
    const keyboardOpen =
      editable && window.visualViewport && window.innerHeight - window.visualViewport.height > 120;
    nav.hidden = Boolean(keyboardOpen);
    if (nav.hidden || drag) return;
    const b = bounds();
    const x = state.collapsed ? (state.x < 0.5 ? 0 : 1) : state.x;
    place(b.minX + x * (b.maxX - b.minX), b.minY + state.y * (b.maxY - b.minY));
  }

  function scheduleRender() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function rememberPosition() {
    const b = bounds();
    const rect = nav.getBoundingClientRect();
    state.x = clamp((rect.left - b.minX) / Math.max(1, b.maxX - b.minX), 0, 1);
    state.y = clamp((rect.top - b.minY) / Math.max(1, b.maxY - b.minY), 0, 1);
    if (state.collapsed) state.x = state.x < 0.5 ? 0 : 1;
    saveState();
  }

  collapse.addEventListener("click", () => {
    state.collapsed = true;
    saveState();
    render();
    tab.focus({ preventScroll: true });
  });

  tab.addEventListener("click", () => {
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      return;
    }
    state.collapsed = false;
    saveState();
    render();
    grip.focus({ preventScroll: true });
  });

  nav.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    suppressClickUntil = 0;
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      target: event.target.closest("a, button"),
      cancelled: false
    };
    const rect = nav.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      left: rect.left,
      top: rect.top,
      moved: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  });

  document.addEventListener(
    "pointermove",
    (event) => {
      if (press?.id === event.pointerId) {
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 8) {
          press.cancelled = true;
        }
      }
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 8) return;
      if (!drag.moved) {
        drag.moved = true;
        nav.dataset.dragging = "true";
      }
      if (event.cancelable) event.preventDefault();
      const b = bounds();
      place(clamp(drag.left + dx, b.minX, b.maxX), clamp(drag.top + dy, b.minY, b.maxY));
    },
    { passive: false }
  );

  nav.addEventListener("pointerup", (event) => {
    const activation = press;
    press = null;
    if (!activation || activation.id !== event.pointerId || activation.cancelled || drag?.moved) return;
    if (!activation.target || ![...links, collapse, tab].includes(activation.target)) return;
    event.preventDefault();
    activation.target.click();
    suppressClickUntil = Date.now() + 500;
  });

  function endDrag(event) {
    if (press?.id === event.pointerId) press = null;
    if (!drag || event.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    delete nav.dataset.dragging;
    if (moved) {
      suppressClickUntil = Date.now() + 500;
      rememberPosition();
    }
    if (nav.hasPointerCapture(event.pointerId)) nav.releasePointerCapture(event.pointerId);
    render();
  }

  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
  nav.addEventListener("lostpointercapture", (event) => {
    if (event.target === nav) endDrag(event);
  });
  nav.addEventListener("dragstart", (event) => event.preventDefault());
  nav.addEventListener(
    "click",
    (event) => {
      if (event.detail !== 0 && Date.now() < suppressClickUntil) {
        suppressClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    true
  );

  for (const control of [grip, tab]) {
    control.addEventListener("keydown", (event) => {
      const direction = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1]
      }[event.key];
      if (!direction) return;
      event.preventDefault();
      const b = bounds();
      const rect = nav.getBoundingClientRect();
      const step = event.shiftKey ? 30 : 10;
      const x =
        state.collapsed && direction[0]
          ? direction[0] < 0
            ? b.minX
            : b.maxX
          : rect.left + direction[0] * step;
      place(clamp(x, b.minX, b.maxX), clamp(rect.top + direction[1] * step, b.minY, b.maxY));
      rememberPosition();
      render();
    });
  }

  window.addEventListener("resize", scheduleRender);
  window.addEventListener("pageshow", scheduleRender);
  window.visualViewport?.addEventListener("resize", scheduleRender);
  window.visualViewport?.addEventListener("scroll", scheduleRender);
  document.addEventListener("focusin", scheduleRender);
  document.addEventListener("focusout", scheduleRender);
  window.addEventListener("storage", (event) => {
    if (event.key === storageKey && !drag) {
      state = readState();
      scheduleRender();
    }
  });
  render();
})();
