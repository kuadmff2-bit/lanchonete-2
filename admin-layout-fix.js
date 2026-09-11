(() => {
  const STYLE_ID = "admin-layout-fix-style";
  const MODAL_CLASS = "promo-edit-modal-open";
  const BACKDROP_ID = "promoEditBackdrop";

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body.admin-view .admin-product{display:grid!important;grid-template-columns:96px minmax(0,1fr) auto!important;align-items:start!important;gap:14px!important;overflow:hidden!important}
      body.admin-view .admin-product-image{grid-column:1!important;width:96px!important;height:96px!important;min-width:96px!important;aspect-ratio:1/1!important;align-self:start!important;position:relative!important;z-index:1!important}
      body.admin-view .admin-product-main{grid-column:2!important;min-width:0!important;width:100%!important;overflow:hidden!important;padding-top:3px!important;text-align:left!important;display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:flex-start!important}
      body.admin-view .admin-product-main strong{display:block!important;width:100%!important;max-width:100%!important;margin:0!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important;overflow-wrap:anywhere!important;word-break:normal!important;line-height:1.25!important;text-align:left!important}
      body.admin-view .admin-product-main small{display:block!important;width:100%!important;max-width:100%!important;margin-left:0!important;white-space:normal!important;overflow-wrap:anywhere!important;line-height:1.35!important;text-align:left!important}
      body.admin-view .admin-product-main .availability{display:inline-flex!important;align-self:flex-start!important;max-width:100%!important;margin-left:0!important;white-space:normal!important;text-align:center!important}
      body.admin-view .product-actions{grid-column:3!important;min-width:0!important;align-self:start!important}
      #${BACKDROP_ID}{position:fixed;inset:0;z-index:9990;background:rgba(7,7,7,.92);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      body.${MODAL_CLASS}{overflow:hidden!important;overscroll-behavior:none!important}
      body.${MODAL_CLASS} #promoV2Form{position:fixed!important;z-index:9991!important;top:max(10px,env(safe-area-inset-top))!important;left:50%!important;transform:translateX(-50%)!important;width:min(620px,calc(100vw - 20px))!important;max-width:calc(100vw - 20px)!important;max-height:calc(100dvh - 20px)!important;margin:0!important;padding:18px!important;overflow-y:auto!important;overflow-x:hidden!important;overscroll-behavior:contain!important;border:1px solid var(--line,#2c2c2c)!important;border-radius:20px!important;background:var(--card,#171717)!important;box-shadow:0 28px 90px rgba(0,0,0,.65)!important}
      body.${MODAL_CLASS} #promoV2Form .promo-v2-form-grid{grid-template-columns:minmax(0,1fr)!important;gap:13px!important}
      body.${MODAL_CLASS} #promoV2Form .promo-v2-form-grid .full{grid-column:auto!important}
      body.${MODAL_CLASS} #promoV2ImagePreview{width:min(100%,330px)!important;margin:0 auto!important}
      body.${MODAL_CLASS} #promoV2Live{display:none!important}
      body.${MODAL_CLASS} #promoV2Form .promo-v2-toggles{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
      body.${MODAL_CLASS} #promoV2Form .promo-v2-toggles label{min-width:0!important;align-items:flex-start!important;line-height:1.35!important}
      body.${MODAL_CLASS} #promoV2Form .promo-v2-form-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important}
      body.${MODAL_CLASS} #promoV2Form input,body.${MODAL_CLASS} #promoV2Form textarea,body.${MODAL_CLASS} #promoV2Form button{max-width:100%!important}
      body.${MODAL_CLASS} .image-editor-backdrop{z-index:10020!important}
      @media(max-width:850px){body.admin-view .admin-product{grid-template-columns:82px minmax(0,1fr)!important;align-items:start!important}body.admin-view .admin-product-image{width:82px!important;height:82px!important;min-width:82px!important}body.admin-view .admin-product-main{grid-column:2!important;padding-left:2px!important}body.admin-view .product-actions{grid-column:1/-1!important;display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;width:100%!important;gap:8px!important}body.admin-view .product-actions button{min-width:0!important;width:100%!important}}
      @media(max-width:480px){body.admin-view .admin-product{grid-template-columns:68px minmax(0,1fr)!important;column-gap:14px!important;row-gap:10px!important;padding:10px!important}body.admin-view .admin-product-image{width:68px!important;height:68px!important;min-width:68px!important}body.admin-view .admin-product-main{padding-left:0!important;min-width:0!important}body.admin-view .admin-product-main strong{font-size:15px!important;line-height:1.2!important}body.admin-view .admin-product-main small{font-size:12px!important;line-height:1.3!important}body.admin-view .admin-product-main .availability{margin-top:7px!important;font-size:10px!important}body.admin-view .product-actions button{padding:9px 7px!important;font-size:11px!important}body.${MODAL_CLASS} #promoV2Form{top:max(6px,env(safe-area-inset-top))!important;width:calc(100vw - 12px)!important;max-width:calc(100vw - 12px)!important;max-height:calc(100dvh - 12px)!important;padding:14px!important;border-radius:16px!important}body.${MODAL_CLASS} #promoV2Form .promo-v2-toggles,body.${MODAL_CLASS} #promoV2Form .promo-v2-form-actions{grid-template-columns:1fr!important}body.${MODAL_CLASS} #promoV2ImagePreview{width:min(100%,280px)!important}}
    `;
    document.head.appendChild(style);
  }

  function closePromoEditor() {
    document.body.classList.remove(MODAL_CLASS);
    document.getElementById(BACKDROP_ID)?.remove();
    const title = document.getElementById("promoV2FormTitle");
    if (title) title.textContent = "Adicionar promoção";
  }

  function openPromoEditor() {
    const form = document.getElementById("promoV2Form");
    if (!form) return;
    installStyles();
    let backdrop = document.getElementById(BACKDROP_ID);
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = BACKDROP_ID;
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", () => {
        const cancel = document.getElementById("promoV2Cancel");
        if (cancel && !cancel.hidden) cancel.click();
        else closePromoEditor();
      });
      document.body.appendChild(backdrop);
    }
    document.body.classList.add(MODAL_CLASS);
    const title = document.getElementById("promoV2FormTitle");
    if (title) title.textContent = "Editar promoção";
    requestAnimationFrame(() => {
      form.scrollTop = 0;
      document.getElementById("promoV2Title")?.focus({ preventScroll: true });
    });
  }

  function installStatusObserver() {
    const status = document.getElementById("promoStatus");
    if (!status || status.dataset.layoutFixObserved === "1") return Boolean(status);
    status.dataset.layoutFixObserved = "1";
    const observer = new MutationObserver(() => {
      const text = String(status.textContent || "");
      if (document.body.classList.contains(MODAL_CLASS) && status.classList.contains("ok") && /promoção atualizada/i.test(text)) closePromoEditor();
    });
    observer.observe(status, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
    return true;
  }

  installStyles();
  document.addEventListener("click", (event) => {
    const edit = event.target.closest?.("[data-promo-edit]");
    if (edit) { setTimeout(() => { openPromoEditor(); installStatusObserver(); }, 0); return; }
    const cancel = event.target.closest?.("#promoV2Cancel");
    if (cancel) setTimeout(closePromoEditor, 0);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.body.classList.contains(MODAL_CLASS)) return;
    event.preventDefault();
    const imageEditor = document.querySelector(".image-editor-backdrop:not([hidden])");
    if (imageEditor) return;
    const cancel = document.getElementById("promoV2Cancel");
    if (cancel && !cancel.hidden) cancel.click(); else closePromoEditor();
  });
  let tries = 0;
  const timer = setInterval(() => { tries += 1; const ready = installStatusObserver(); if (ready || tries > 80) clearInterval(timer); }, 250);
})();