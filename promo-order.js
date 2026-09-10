// Promoções clicáveis com valor fixo definido pelo administrador.
(() => {
  const PROMO_CART_KEY = "__promotion_order__";
  const promoCard = $("#promoCard");
  const promoOrderMeta = $("#promoOrderMeta");
  const promoOrderPrice = $("#promoOrderPrice");
  const promoOrderButton = $("#promoOrderButton");
  const selectedPromoBox = $("#selectedPromoBox");
  const selectedPromoTitle = $("#selectedPromoTitle");
  const selectedPromoPrice = $("#selectedPromoPrice");

  let activePromotion = null;

  function promotionSelected() {
    return Boolean(activePromotion?.id && activePromotion?.orderEnabled && cart.has(PROMO_CART_KEY));
  }

  function syncSelectedPromoBox() {
    const selected = promotionSelected();
    if (!selectedPromoBox) return;
    selectedPromoBox.hidden = !selected;
    if (!selected) return;
    selectedPromoTitle.textContent = activePromotion.title || "Promoção";
    selectedPromoPrice.textContent = money(activePromotion.price);
  }

  const originalCartDetails = cartDetails;
  cartDetails = function () {
    const details = originalCartDetails();
    if (promotionSelected()) {
      details.count += 1;
      details.total = Number((details.total + Number(activePromotion.price || 0)).toFixed(2));
    }
    return details;
  };

  const originalOrderItems = orderItems;
  orderItems = function () {
    const items = originalOrderItems();
    if (promotionSelected()) {
      items.unshift({
        id: PROMO_CART_KEY,
        name: `Promoção: ${activePromotion.title}`,
        qty: 1,
        price: Number(activePromotion.price || 0),
        isPromotion: true,
        promotionId: activePromotion.id
      });
    }
    return items;
  };

  const originalRenderCart = renderCart;
  renderCart = function () {
    originalRenderCart();

    if (promotionSelected()) {
      cartItemsEl.insertAdjacentHTML("afterbegin", `
        <div class="cart-item promo-cart-item">
          <div>
            <span class="promo-cart-label">PROMOÇÃO</span>
            <strong>${esc(activePromotion.title || "Promoção")}</strong>
            <small>Valor promocional fixo</small>
            <button class="remove-promo-button" type="button" data-remove-promo>Remover promoção</button>
          </div>
          <strong>${money(activePromotion.price)}</strong>
        </div>`);
    }

    syncSelectedPromoBox();
  };

  registerOrder = async function (formData) {
    const regularItems = [...cart.entries()].map(([id, qty]) => {
      if (String(id) === PROMO_CART_KEY) return null;
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
      promoId: promotionSelected() ? String(activePromotion.id) : "",
      items: regularItems
    };

    const data = await submitOrderPayload(payload);
    return Object.assign(data.order, { _messaging: data.messaging || null });
  };

  loadPromotion = async function () {
    const promoSection = $("#promoSection");
    try {
      const response = await fetch("/api/promo", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const promo = await response.json();
      if (!promo?.active || (!promo.image && !promo.title && !promo.description)) {
        promoSection.hidden = true;
        activePromotion = null;
        cart.delete(PROMO_CART_KEY);
        renderCart();
        return;
      }

      const image = $("#promoImage");
      if (promo.image) {
        image.src = promo.image;
        image.hidden = false;
      } else {
        image.hidden = true;
      }
      $("#promoTitle").textContent = promo.title || "Promoção do dia";
      $("#promoDescription").textContent = promo.description || "";

      const price = Number(promo.price || 0);
      const hasPrice = Number.isFinite(price) && price > 0;
      const orderEnabled = Boolean(promo.orderEnabled && promo.id && hasPrice);
      activePromotion = orderEnabled ? { ...promo, price, orderEnabled: true } : null;

      promoOrderMeta.hidden = !hasPrice;
      if (hasPrice) promoOrderPrice.textContent = money(price);

      if (orderEnabled) {
        promoOrderButton.disabled = false;
        promoOrderButton.textContent = `Pedir esta promoção · ${money(price)}`;
        const hint = promoOrderMeta.querySelector(".promo-order-hint");
        if (hint) hint.textContent = "Toque em qualquer parte da promoção para ir direto ao pedido.";
        promoCard.classList.add("promo-orderable");
        promoCard.classList.remove("promo-unavailable");
        promoCard.setAttribute("role", "button");
        promoCard.setAttribute("tabindex", "0");
        promoCard.setAttribute("aria-label", `Pedir ${promo.title} por ${money(price)}`);
      } else {
        promoOrderButton.disabled = true;
        promoOrderButton.textContent = "Promoção indisponível";
        const hint = promoOrderMeta.querySelector(".promo-order-hint");
        if (hint) hint.textContent = "Esta promoção está indisponível para pedidos no momento.";
        promoCard.classList.remove("promo-orderable");
        promoCard.classList.add("promo-unavailable");
        promoCard.removeAttribute("role");
        promoCard.removeAttribute("tabindex");
        promoCard.removeAttribute("aria-label");
        cart.delete(PROMO_CART_KEY);
      }

      promoSection.hidden = false;
      renderCart();
    } catch {
      promoSection.hidden = true;
    }
  };

  function choosePromotion() {
    if (!activePromotion?.orderEnabled) return;
    cart.set(PROMO_CART_KEY, 1);
    renderCart();
    openCheckout();
  }

  promoCard.addEventListener("click", () => choosePromotion());
  promoCard.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    choosePromotion();
  });

  document.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove-promo]");
    if (!remove) return;
    event.preventDefault();
    event.stopPropagation();
    cart.delete(PROMO_CART_KEY);
    renderCart();
  });

  loadPromotion();
})();
