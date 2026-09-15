// Promoção clicável usando somente a API interna do próprio Worker.
(() => {
  const KEY = "__promotion_order__";
  const section = $("#promoSection");
  const box = $("#selectedPromoBox");
  const boxTitle = $("#selectedPromoTitle");
  const boxPrice = $("#selectedPromoPrice");
  let promotion = null;

  const chosen = () => Boolean(promotion?.id && promotion?.orderEnabled && cart.has(KEY));

  function syncBox() {
    if (!box) return;
    box.hidden = !chosen();
    if (chosen()) {
      boxTitle.textContent = promotion.title || "Promoção";
      boxPrice.textContent = money(promotion.price);
    }
  }

  const baseCartDetails = cartDetails;
  cartDetails = function () {
    const details = baseCartDetails();
    if (chosen()) {
      details.count += 1;
      details.total = Number((details.total + Number(promotion.price || 0)).toFixed(2));
    }
    return details;
  };

  const baseRenderCart = renderCart;
  renderCart = function () {
    baseRenderCart();
    if (chosen()) {
      cartItemsEl.insertAdjacentHTML("afterbegin", `<div class="cart-item promo-cart-item"><div><span class="promo-cart-label">PROMOÇÃO</span><strong>${esc(promotion.title || "Promoção")}</strong><small>Valor promocional fixo</small><button class="remove-promo-button" type="button" data-remove-promo>Remover promoção</button></div><strong>${money(promotion.price)}</strong></div>`);
    }
    syncBox();
  };

  registerOrder = async function (formData) {
    const regularItems = [...cart.entries()].map(([id, qty]) => {
      if (String(id) === KEY) return null;
      const product = products.find((item) => String(item.id) === String(id));
      return product ? { id: String(product.id), name: product.name, qty } : null;
    }).filter(Boolean);

    const payload = {
      clientOrderId: clientOrderId(),
      localDate: localDateKey(),
      customerName: formData.get("customerName"),
      customerPhone: formData.get("customerPhone"),
      payment: formData.get("payment"),
      deliveryType: formData.get("deliveryType"),
      address: formData.get("address") || "",
      reference: formData.get("reference") || "",
      changeFor: formData.get("changeFor") || "",
      note: formData.get("orderNote") || "",
      promoId: chosen() ? String(promotion.id) : "",
      items: regularItems
    };

    const data = await submitOrderPayload(payload);
    return data.order;
  };

  function normalize(promo) {
    if (!promo || typeof promo !== "object" || !promo.active) return null;
    const price = Number(promo.price || 0);
    return {
      ...promo,
      id: String(promo.id || ""),
      price,
      orderEnabled: Boolean(promo.orderEnabled && Number.isFinite(price) && price > 0)
    };
  }

  function render() {
    if (!section) return;
    if (!promotion || (!promotion.image && !promotion.title && !promotion.description)) {
      section.hidden = true;
      cart.delete(KEY);
      syncBox();
      return;
    }

    const orderable = promotion.orderEnabled;
    section.innerHTML = `<div class="promo-list"><article class="promo-card ${orderable ? "promo-orderable" : "promo-unavailable"}" ${orderable ? 'role="button" tabindex="0"' : ""}>${promotion.image ? `<img class="promo-image" src="${promotion.image}" alt="${esc(promotion.title || "Imagem da promoção")}">` : '<div class="promo-image promo-image-empty">PROMOÇÃO</div>'}<div class="promo-content"><span class="promo-label">PROMOÇÃO</span><h2>${esc(promotion.title || "Promoção")}</h2><p>${esc(promotion.description || "")}</p><div class="promo-order-meta">${promotion.price > 0 ? `<strong class="promo-order-price">${money(promotion.price)}</strong>` : ""}<button class="promo-order-button" type="button" data-promo-order ${orderable ? "" : "disabled"}>${orderable ? `Pedir esta promoção · ${money(promotion.price)}` : "Promoção indisponível"}</button><small class="promo-order-hint">${orderable ? "Toque na promoção para ir direto ao pedido." : "Oferta visível no momento."}</small></div></div></article></div>`;
    section.hidden = false;
  }

  loadPromotion = async function () {
    try {
      const response = await fetch("/api/promo", { cache: "no-store" });
      promotion = response.ok ? normalize(await response.json()) : null;
    } catch {
      promotion = null;
    }
    if (!promotion) cart.delete(KEY);
    render();
    renderCart();
  };

  function choosePromotion() {
    if (!promotion?.orderEnabled) return;
    cart.set(KEY, 1);
    renderCart();
    openCheckout();
  }

  section?.addEventListener("click", (event) => {
    if (!event.target.closest("[data-promo-order], .promo-orderable")) return;
    event.preventDefault();
    choosePromotion();
  });

  section?.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.closest(".promo-orderable")) {
      event.preventDefault();
      choosePromotion();
    }
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-promo]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    cart.delete(KEY);
    renderCart();
  });

  loadPromotion();
})();
