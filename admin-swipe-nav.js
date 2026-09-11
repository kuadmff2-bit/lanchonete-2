(() => {
  const root = document.getElementById("adminApp");
  if (!root || root.dataset.swipeNavigationV2 === "1") return;
  root.dataset.swipeNavigationV2 = "1";

  const state = {
    tracking: false,
    horizontal: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    startedAt: 0,
    suppressClickUntil: 0
  };

  function swipeBlocked() {
    return Boolean(
      document.body.classList.contains("promo-edit-modal-open") ||
      document.querySelector(".image-editor-backdrop:not([hidden])") ||
      document.getElementById("promoEditBackdrop")
    );
  }

  function blockedTarget(target) {
    return Boolean(target?.closest?.(
      "input,textarea,select,[contenteditable='true'],.admin-tabs,.editor-stage,.editor-controls,.image-picker,input[type='range']"
    ));
  }

  function insideHorizontalScroller(target) {
    let node = target instanceof Element ? target : null;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth + 6) return true;
      node = node.parentElement;
    }
    return false;
  }

  function buttons() {
    return Array.from(root.querySelectorAll(".admin-tabs .tab-button"))
      .filter((button) => !button.hidden && !button.disabled && getComputedStyle(button).display !== "none");
  }

  function activeIndex(list) {
    const byButton = list.findIndex((button) => button.classList.contains("active"));
    if (byButton >= 0) return byButton;
    const panel = root.querySelector(".tab-panel.active");
    const name = panel?.id?.startsWith("tab-") ? panel.id.slice(4) : "";
    return list.findIndex((button) => button.dataset.tab === name);
  }

  function reset() {
    state.tracking = false;
    state.horizontal = false;
    state.startX = 0;
    state.startY = 0;
    state.lastX = 0;
    state.lastY = 0;
    state.startedAt = 0;
  }

  function switchDirection(direction) {
    const list = buttons();
    const index = activeIndex(list);
    const next = index + direction;
    if (index < 0 || next < 0 || next >= list.length) return;

    state.suppressClickUntil = performance.now() + 450;
    const button = list[next];
    button.click();
    button.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });

    const nav = root.querySelector(".admin-tabs");
    if (nav) {
      const top = nav.getBoundingClientRect().top + window.scrollY - 8;
      window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    }
  }

  root.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || swipeBlocked()) return;
    const target = event.target;
    if (blockedTarget(target) || insideHorizontalScroller(target)) return;

    const touch = event.touches[0];
    state.tracking = true;
    state.horizontal = false;
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.lastX = touch.clientX;
    state.lastY = touch.clientY;
    state.startedAt = performance.now();
  }, { passive: true });

  root.addEventListener("touchmove", (event) => {
    if (!state.tracking || event.touches.length !== 1) return;
    const touch = event.touches[0];
    state.lastX = touch.clientX;
    state.lastY = touch.clientY;

    const dx = state.lastX - state.startX;
    const dy = state.lastY - state.startY;

    if (!state.horizontal) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx) * 1.15) {
        reset();
        return;
      }
      if (Math.abs(dx) >= 14 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        state.horizontal = true;
      }
    }

    if (state.horizontal) event.preventDefault();
  }, { passive: false });

  root.addEventListener("touchend", () => {
    if (!state.tracking) return reset();

    const dx = state.lastX - state.startX;
    const dy = state.lastY - state.startY;
    const elapsed = Math.max(1, performance.now() - state.startedAt);
    const velocity = Math.abs(dx) / elapsed;
    const horizontalEnough = Math.abs(dx) > Math.abs(dy) * 1.25;
    const distanceEnough = Math.abs(dx) >= 58 || (Math.abs(dx) >= 42 && velocity >= 0.45);

    if (state.horizontal && horizontalEnough && distanceEnough) {
      switchDirection(dx < 0 ? 1 : -1);
    }
    reset();
  }, { passive: true });

  root.addEventListener("touchcancel", reset, { passive: true });

  document.addEventListener("click", (event) => {
    if (performance.now() >= state.suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();