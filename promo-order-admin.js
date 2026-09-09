// Controle simples da promoção: sempre aparece no site; disponível = clicável para pedir.
(() => {
  const promoPrice = $("#promoPrice");
  const promoOrderEnabled = $("#promoOrderEnabled");
  const promoActive = $("#promoActive");
  const previewPromoPrice = $("#previewPromoPrice");
  const previewPromoHint = $("#previewPromoHint");
  const hidePromoButton = $("#hidePromoButton");

  // Os checkboxes antigos continuam apenas como estado interno para manter
  // compatibilidade com o painel, mas nunca são mostrados ao usuário.
  if (promoOrderEnabled?.closest("label")) {
    promoOrderEnabled.closest("label").hidden = true;
    promoOrderEnabled.closest("label").style.display = "none";
  }
  if (promoActive?.closest("label")) {
    promoActive.closest("label").hidden = true;
    promoActive.closest("label").style.display = "none";
  }
  if (promoActive) promoActive.checked = true;

  const settingsText = document.querySelector(".promo-order-settings > p");
  if (settingsText) {
    settingsText.textContent = "Defina o valor final. Quando a promoção estiver disponível, o cliente toca nela e vai direto para preencher os dados do pedido.";
  }

  const availableButton = document.createElement("button");
  availableButton.type = "button";
  availableButton.id = "promoAvailableButton";
  availableButton.className = "promo-availability-button available";
  availableButton.textContent = "Disponibilizar";

  hidePromoButton.textContent = "Indisponibilizar";
  hidePromoButton.className = "promo-availability-button unavailable";

  const availabilityActions = document.createElement("div");
  availabilityActions.className = "promo-availability-actions";
  hidePromoButton.parentNode.insertBefore(availabilityActions, hidePromoButton);
  availabilityActions.append(availableButton, hidePromoButton);

  function numericPromoPrice() {
    const value = Number(promoPrice.value);
    return Number.isFinite(value) ? value : 0;
  }

  function syncAvailabilityButtons() {
    const available = promoOrderEnabled.checked;
    availableButton.classList.toggle("is-active", available);
    hidePromoButton.classList.toggle("is-active", !available);
    availableButton.setAttribute("aria-pressed", available ? "true" : "false");
    hidePromoButton.setAttribute("aria-pressed", !available ? "true" : "false");
  }

  const previousUpdatePromoPreview = updatePromoPreview;
  updatePromoPreview = function () {
    previousUpdatePromoPreview();
    const price = numericPromoPrice();
    const available = promoOrderEnabled.checked && price > 0;
    previewPromoPrice.textContent = price > 0 ? money(price) : "";
    previewPromoPrice.hidden = price <= 0;
    previewPromoHint.textContent = available
      ? "Disponível: no site, o cliente pode tocar na promoção e ir direto para finalizar o pedido."
      : "Indisponível: a promoção continua visível no site, mas não aceita pedido até ser disponibilizada.";
    syncAvailabilityButtons();
  };

  const previousLoadPromotion = loadPromotion;
  loadPromotion = async function () {
    await previousLoadPromotion();
    try {
      const response = await fetch("/api/promo", { cache: "no-store" });
      if (!response.ok) return;
      const promo = await response.json();
      promoPrice.value = Number(promo.price || 0) > 0 ? Number(promo.price) : "";
      promoOrderEnabled.checked = Boolean(promo.orderEnabled);
      promoActive.checked = true;
      updatePromoPreview();
    } catch {}
  };

  // O botão de publicar mantém a disponibilidade atual. Os dois botões grandes
  // abaixo são os únicos controles de disponibilidade visíveis no painel.
  savePromotion = async function (availabilityOverride = null) {
    if (typeof availabilityOverride === "boolean") {
      promoOrderEnabled.checked = availabilityOverride;
    }

    const title = $("#promoTitle").value.trim();
    const price = numericPromoPrice();
    const available = promoOrderEnabled.checked;

    if (!title) {
      setStatus("#promoStatus", "Digite o título da promoção.", "error");
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      setStatus("#promoStatus", "Informe um valor maior que zero para a promoção.", "error");
      return;
    }

    setStatus("#promoStatus", available ? "Salvando promoção disponível..." : "Salvando promoção indisponível...");
    try {
      await api("/api/promo", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          active: true,
          title,
          description: $("#promoDescription").value.trim(),
          image: promoImageData,
          price,
          orderEnabled: available
        })
      });
      promoActive.checked = true;
      setStatus(
        "#promoStatus",
        available ? "Promoção disponível no site e pronta para receber pedidos." : "Promoção indisponível para pedidos, mas continua visível no site.",
        "ok"
      );
      updatePromoPreview();
    } catch (error) {
      setStatus("#promoStatus", error.message, "error");
    }
  };

  availableButton.addEventListener("click", () => savePromotion(true));

  [promoPrice, $("#promoTitle"), $("#promoDescription")].forEach((control) => {
    control.addEventListener("input", updatePromoPreview);
    control.addEventListener("change", updatePromoPreview);
  });

  const promoStatus = $("#promoStatus");
  const deleteObserver = new MutationObserver(() => {
    if (!promoStatus.textContent.includes("excluída definitivamente")) return;
    promoPrice.value = "";
    promoOrderEnabled.checked = true;
    promoActive.checked = true;
    updatePromoPreview();
  });
  deleteObserver.observe(promoStatus, { childList: true, characterData: true, subtree: true });

  promoOrderEnabled.checked = true;
  syncAvailabilityButtons();
})();

// Editor simples de foto: arrastar para enquadrar, pinça para zoom e OK.
// Vale tanto para as fotos dos produtos quanto para a foto da promoção.
(() => {
  const stage = document.querySelector(".editor-stage");
  const canvas = $("#imageEditorCanvas");
  const ctx = canvas.getContext("2d");
  const saveButton = $("#saveImageEditor");
  const cancelButton = $("#cancelImageEditor");

  if (!stage || !canvas || !ctx) return;

  saveButton.textContent = "OK";
  cancelButton.textContent = "Cancelar";

  let hint = stage.nextElementSibling;
  if (!hint || !hint.classList.contains("simple-crop-hint")) {
    hint = document.createElement("p");
    hint.className = "simple-crop-hint";
    hint.textContent = "Arraste para posicionar e use dois dedos para dar zoom";
    stage.insertAdjacentElement("afterend", hint);
  }

  const state = {
    scale: 1,
    minScale: 1,
    maxScale: 3,
    offsetX: 0,
    offsetY: 0
  };

  const pointers = new Map();
  let previousPinchDistance = 0;
  let previousPinchMidpoint = null;

  function setCanvasForAspect(aspect) {
    if (aspect === "1:1") {
      canvas.width = 720;
      canvas.height = 720;
    } else if (aspect === "16:9") {
      canvas.width = 960;
      canvas.height = 540;
    } else {
      canvas.width = 800;
      canvas.height = 600;
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampOffsets() {
    if (!editorImage) return;
    const drawnWidth = editorImage.width * state.scale;
    const drawnHeight = editorImage.height * state.scale;
    const maxX = Math.max(0, (drawnWidth - canvas.width) / 2);
    const maxY = Math.max(0, (drawnHeight - canvas.height) / 2);
    state.offsetX = clamp(state.offsetX, -maxX, maxX);
    state.offsetY = clamp(state.offsetY, -maxY, maxY);
  }

  function renderCrop() {
    if (!editorImage) return;
    clampOffsets();

    const drawnWidth = editorImage.width * state.scale;
    const drawnHeight = editorImage.height * state.scale;
    const drawX = (canvas.width - drawnWidth) / 2 + state.offsetX;
    const drawY = (canvas.height - drawnHeight) / 2 + state.offsetY;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#050708";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(editorImage, drawX, drawY, drawnWidth, drawnHeight);
  }

  function initializeCrop(aspect) {
    setCanvasForAspect(aspect);
    const coverScale = Math.max(
      canvas.width / editorImage.width,
      canvas.height / editorImage.height
    );
    state.minScale = coverScale;
    state.maxScale = coverScale * 3;
    state.scale = coverScale;
    state.offsetX = 0;
    state.offsetY = 0;
    pointers.clear();
    previousPinchDistance = 0;
    previousPinchMidpoint = null;
    renderCrop();
  }

  function canvasRatio() {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.width ? canvas.width / rect.width : 1,
      y: rect.height ? canvas.height / rect.height : 1
    };
  }

  function currentTwoPointers() {
    const values = [...pointers.values()];
    if (values.length < 2) return null;
    const a = values[0];
    const b = values[1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      distance: Math.hypot(dx, dy),
      midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    };
  }

  function resetGestureReference() {
    if (pointers.size >= 2) {
      const pair = currentTwoPointers();
      previousPinchDistance = pair?.distance || 0;
      previousPinchMidpoint = pair?.midpoint || null;
    } else {
      previousPinchDistance = 0;
      previousPinchMidpoint = null;
    }
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    canvas.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    resetGestureReference();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId) || !editorImage) return;
    event.preventDefault();

    const previous = pointers.get(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const ratio = canvasRatio();

    if (pointers.size === 1) {
      state.offsetX += (event.clientX - previous.x) * ratio.x;
      state.offsetY += (event.clientY - previous.y) * ratio.y;
      renderCrop();
      return;
    }

    const pair = currentTwoPointers();
    if (!pair) return;

    if (previousPinchDistance > 0 && pair.distance > 0) {
      const zoomFactor = pair.distance / previousPinchDistance;
      state.scale = clamp(state.scale * zoomFactor, state.minScale, state.maxScale);
    }

    if (previousPinchMidpoint) {
      state.offsetX += (pair.midpoint.x - previousPinchMidpoint.x) * ratio.x;
      state.offsetY += (pair.midpoint.y - previousPinchMidpoint.y) * ratio.y;
    }

    previousPinchDistance = pair.distance;
    previousPinchMidpoint = pair.midpoint;
    renderCrop();
  });

  function releasePointer(event) {
    pointers.delete(event.pointerId);
    resetGestureReference();
  }

  canvas.addEventListener("pointerup", releasePointer);
  canvas.addEventListener("pointercancel", releasePointer);
  canvas.addEventListener("lostpointercapture", releasePointer);

  canvas.addEventListener("wheel", (event) => {
    if (!editorImage) return;
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.08 : 0.92;
    state.scale = clamp(state.scale * factor, state.minScale, state.maxScale);
    renderCrop();
  }, { passive: false });

  // Substitui o editor antigo sem alterar o restante do fluxo de upload/salvamento.
  openImageEditor = async function (src, { title = "Editar imagem", aspect = "4:3", onSave } = {}) {
    if (!src) return;
    try {
      editorImage = await loadEditorImage(src);
      editorCallback = onSave || null;
      if ($("#imageEditorTitle")) $("#imageEditorTitle").textContent = title;
      if (editorAspect) editorAspect.value = aspect;
      initializeCrop(aspect);
      editorBackdrop.hidden = false;
      document.body.style.overflow = "hidden";
    } catch (error) {
      const statusTarget = title.toLowerCase().includes("promo") ? "#promoStatus" : "#productStatus";
      setStatus(statusTarget, error.message || "Não foi possível abrir a imagem.", "error");
    }
  };
})();