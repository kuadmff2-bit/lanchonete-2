(() => {
  const STYLE_ID = "admin-cleanup-ui-style";

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      body.admin-view #robotPanel .robot-stability-note,
      body.admin-view #robotPanel .robot-admin-card:not(.robot-connection-card),
      body.admin-view .security-note{display:none!important}

      body.admin-view #promoV2Live{display:none!important}
      body.admin-view #promoV2Form .card-title span{display:none!important}
      body.admin-view #promoV2Form .card-title{margin-bottom:14px!important}
      body.admin-view #promoV2ImagePreview.promo-image-empty{
        aspect-ratio:auto!important;
        min-height:72px!important;
        height:72px!important;
      }
      body.admin-view #promoV2ImagePreview.promo-image-empty span{
        padding:12px!important;
        font-size:13px!important;
      }

      body.admin-view .promo-v2-toggles{
        display:grid!important;
        grid-template-columns:repeat(2,minmax(0,1fr))!important;
        gap:10px!important;
        margin-top:2px!important;
      }
      body.admin-view .promo-v2-toggles label{
        position:relative!important;
        display:flex!important;
        align-items:center!important;
        gap:12px!important;
        min-width:0!important;
        min-height:58px!important;
        padding:11px 14px!important;
        border:1px solid var(--line)!important;
        border-radius:14px!important;
        background:var(--card2,var(--surface2))!important;
        color:var(--text)!important;
        font-weight:800!important;
        line-height:1.25!important;
        cursor:pointer!important;
        user-select:none!important;
      }
      body.admin-view .promo-v2-toggles input[type="checkbox"]{
        appearance:none!important;
        -webkit-appearance:none!important;
        width:46px!important;
        min-width:46px!important;
        height:27px!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:999px!important;
        background:#666!important;
        position:relative!important;
        outline:none!important;
        box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)!important;
        transition:background .16s ease!important;
      }
      body.admin-view .promo-v2-toggles input[type="checkbox"]::before{
        content:""!important;
        position:absolute!important;
        width:21px!important;
        height:21px!important;
        top:3px!important;
        left:3px!important;
        border-radius:50%!important;
        background:#fff!important;
        box-shadow:0 2px 6px rgba(0,0,0,.28)!important;
        transition:transform .16s ease!important;
      }
      body.admin-view .promo-v2-toggles input[type="checkbox"]:checked{
        background:var(--brand-primary,var(--orange))!important;
      }
      body.admin-view .promo-v2-toggles input[type="checkbox"]:checked::before{
        transform:translateX(19px)!important;
      }

      body.admin-view .promo-v2-form-actions{
        display:grid!important;
        grid-template-columns:minmax(0,1fr) minmax(120px,.38fr)!important;
        gap:10px!important;
        margin-top:4px!important;
      }
      body.admin-view .promo-v2-form-actions button,
      body.admin-view .promo-v2-image-actions button,
      body.admin-view .promo-v2-actions button{
        min-height:48px!important;
        border-radius:13px!important;
        font-weight:800!important;
        font-size:14px!important;
      }
      body.admin-view #promoV2Save{
        border:0!important;
        background:var(--brand-primary,var(--orange))!important;
        color:var(--brand-on-primary,#fff)!important;
        box-shadow:0 8px 18px rgba(0,0,0,.14)!important;
      }
      body.admin-view #promoV2Cancel{
        background:transparent!important;
        color:var(--text)!important;
        border:1px solid var(--line)!important;
      }
      body.admin-view #promoV2RemoveImage,
      body.admin-view .promo-v2-actions .danger{
        color:#ff9aa3!important;
        border-color:rgba(239,68,68,.34)!important;
        background:rgba(239,68,68,.07)!important;
      }

      @media(max-width:560px){
        body.admin-view .promo-v2-toggles{grid-template-columns:1fr!important}
        body.admin-view .promo-v2-form-actions{grid-template-columns:1fr!important}
        body.admin-view .promo-v2-form-actions button{width:100%!important}
      }
    `;
    document.head.appendChild(style);
  }

  function cleanupRobot() {
    const host = document.getElementById("robotPanel");
    if (!host) return;
    host.querySelectorAll(".robot-admin-card").forEach((card, index) => {
      if (index > 0) card.remove();
    });
    host.querySelector(".robot-stability-note")?.remove();
    document.querySelector(".security-note")?.remove();
  }

  function cleanupPromo() {
    const live = document.getElementById("promoV2Live");
    if (live) live.hidden = true;

    const titleExtra = document.querySelector("#promoV2Form .card-title span");
    if (titleExtra) titleExtra.hidden = true;

    const preview = document.getElementById("promoV2ImagePreview");
    if (preview) {
      const updatePreviewState = () => {
        preview.classList.toggle("promo-image-empty", !preview.querySelector("img"));
      };
      updatePreviewState();
      if (preview.dataset.cleanupObserver !== "1") {
        preview.dataset.cleanupObserver = "1";
        new MutationObserver(updatePreviewState).observe(preview, { childList: true, subtree: true });
      }
    }
  }

  function apply() {
    installStyles();
    cleanupRobot();
    cleanupPromo();
  }

  apply();
  new MutationObserver(apply).observe(document.body, { childList: true, subtree: true });
})();