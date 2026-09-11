(() => {
  const root = document.getElementById("adminApp");
  if (!root || root.dataset.swipeNavigation === "1") return;
  root.dataset.swipeNavigation = "1";

  const STYLE_ID = "admin-swipe-navigation-style";
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body.admin-view .tab-panel.swipe-moving{will-change:transform,opacity;transform-origin:center}
      body.admin-view .tab-panel.swipe-entering{will-change:transform,opacity;transition:transform .16s ease,opacity .16s ease}
    `;
    document.head.appendChild(style);
  }

  const state = { active:false, horizontal:false, decided:false, startX:0, startY:0, lastX:0, startedAt:0, panel:null };

  function resetPanel(panel = state.panel) {
    if (!panel) return;
    panel.classList.remove("swipe-moving");
    panel.style.transition = "";
    panel.style.transform = "";
    panel.style.opacity = "";
  }

  function resetState() {
    resetPanel();
    state.active = false; state.horizontal = false; state.decided = false;
    state.startX = 0; state.startY = 0; state.lastX = 0; state.startedAt = 0; state.panel = null;
  }

  function swipeBlocked() {
    return Boolean(document.body.classList.contains("promo-edit-modal-open") || document.querySelector(".image-editor-backdrop:not([hidden])") || document.getElementById("promoEditBackdrop"));
  }

  function isInteractive(target) {
    return Boolean(target?.closest?.("input,textarea,select,button,a,label,[contenteditable='true'],.admin-tabs,.editor-stage,.editor-controls,.image-picker,.promo-v2-actions,.product-actions"));
  }

  function isInsideHorizontalScroller(target) {
    let node = target instanceof Element ? target : null;
    while (node && node !== root) {
      const style = getComputedStyle(node);
      const overflowX = style.overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 4) return true;
      node = node.parentElement;
    }
    return false;
  }

  function currentPanel() { return root.querySelector(".tab-panel.active"); }
  function tabButtons() {
    return Array.from(root.querySelectorAll(".admin-tabs .tab-button")).filter((button) => !button.hidden && !button.disabled && getComputedStyle(button).display !== "none");
  }
  function activeTabIndex(buttons) {
    const active = buttons.findIndex((button) => button.classList.contains("active"));
    if (active >= 0) return active;
    const panel = currentPanel();
    if (!panel?.id?.startsWith("tab-")) return -1;
    const name = panel.id.slice(4);
    return buttons.findIndex((button) => button.dataset.tab === name);
  }

  function animateBack(panel) {
    if (!panel) return resetState();
    panel.style.transition = "transform .15s ease, opacity .15s ease";
    panel.style.transform = "translate3d(0,0,0)";
    panel.style.opacity = "1";
    setTimeout(resetState, 170);
  }

  function switchBySwipe(dx) {
    const panel = state.panel;
    const buttons = tabButtons();
    const index = activeTabIndex(buttons);
    const direction = dx < 0 ? 1 : -1;
    const nextIndex = index + direction;
    if (!panel || index < 0 || nextIndex < 0 || nextIndex >= buttons.length) return animateBack(panel);

    const nextButton = buttons[nextIndex];
    panel.style.transition = "transform .12s ease, opacity .12s ease";
    panel.style.transform = `translate3d(${direction > 0 ? -44 : 44}px,0,0)`;
    panel.style.opacity = ".7";

    setTimeout(() => {
      resetPanel(panel);
      nextButton.click();
      nextButton.scrollIntoView({ behavior:"smooth", block:"nearest", inline:"center" });
      const nextPanel = currentPanel();
      if (nextPanel) {
        nextPanel.classList.add("swipe-entering");
        nextPanel.style.transition = "none";
        nextPanel.style.transform = `translate3d(${direction > 0 ? 30 : -30}px,0,0)`;
        nextPanel.style.opacity = ".72";
        requestAnimationFrame(() => requestAnimationFrame(() => {
          nextPanel.style.transition = "transform .16s ease, opacity .16s ease";
          nextPanel.style.transform = "translate3d(0,0,0)";
          nextPanel.style.opacity = "1";
          setTimeout(() => {
            nextPanel.classList.remove("swipe-entering");
            nextPanel.style.transition = ""; nextPanel.style.transform = ""; nextPanel.style.opacity = "";
          }, 180);
        }));
      }
      resetState();
    }, 115);
  }

  root.addEventListener("touchstart", (event) => {
    if (event.touches.length !== 1 || swipeBlocked()) return;
    const target = event.target;
    if (isInteractive(target) || isInsideHorizontalScroller(target)) return;
    const touch = event.touches[0];
    state.active = true; state.horizontal = false; state.decided = false;
    state.startX = touch.clientX; state.startY = touch.clientY; state.lastX = touch.clientX;
    state.startedAt = performance.now(); state.panel = currentPanel();
  }, { passive:true });

  root.addEventListener("touchmove", (event) => {
    if (!state.active || event.touches.length !== 1 || !state.panel) return;
    const touch = event.touches[0];
    const dx = touch.clientX - state.startX;
    const dy = touch.clientY - state.startY;
    state.lastX = touch.clientX;
    if (!state.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      state.decided = true;
      state.horizontal = Math.abs(dx) > Math.abs(dy) * 1.18;
      if (!state.horizontal) return resetState();
      state.panel.classList.add("swipe-moving");
    }
    if (!state.horizontal) return;
    event.preventDefault();
    const limit = Math.max(90, Math.min(innerWidth * .34, 170));
    const translated = Math.max(-limit, Math.min(limit, dx));
    state.panel.style.transition = "none";
    state.panel.style.transform = `translate3d(${translated}px,0,0)`;
    state.panel.style.opacity = String(1 - Math.min(.16, Math.abs(translated) / Math.max(innerWidth, 1) * .32));
  }, { passive:false });

  function finishSwipe() {
    if (!state.active || !state.panel) return resetState();
    if (!state.horizontal) return resetState();
    const dx = state.lastX - state.startX;
    const elapsed = Math.max(1, performance.now() - state.startedAt);
    const velocity = Math.abs(dx) / elapsed;
    const threshold = Math.max(48, Math.min(72, innerWidth * .14));
    if (Math.abs(dx) >= threshold || (Math.abs(dx) >= 34 && velocity >= .45)) switchBySwipe(dx);
    else animateBack(state.panel);
  }

  root.addEventListener("touchend", finishSwipe, { passive:true });
  root.addEventListener("touchcancel", () => animateBack(state.panel), { passive:true });
})();