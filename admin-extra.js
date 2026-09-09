// Complementos do painel administrativo.
// Upload mais amigável, editor de recorte e ações rápidas dos produtos.

renderProductList = function () {
  $("#productCount").textContent = products.length === 1 ? "1 produto" : `${products.length} produtos`;
  $("#productList").innerHTML = products.length ? products.map((product) => `
    <article class="admin-product">
      <div class="admin-product-image">${product.image ? `<img src="${product.image}" alt="${esc(product.name)}">` : "Sem foto"}</div>
      <div class="admin-product-main">
        <strong>${esc(product.name)}</strong>
        <small>${product.category === "bebida" ? "Bebida" : "Lanche"} · ${money(product.price)}</small>
        <span class="availability ${product.available === false ? "off" : "on"}">${product.available === false ? "INDISPONÍVEL" : "DISPONÍVEL"}</span>
      </div>
      <div class="product-actions">
        <button type="button" data-photo-product="${esc(product.id)}">Trocar foto</button>
        <button type="button" data-toggle-product="${esc(product.id)}">${product.available === false ? "Disponibilizar" : "Indisponibilizar"}</button>
        <button type="button" data-edit-product="${esc(product.id)}">Editar</button>
        <button type="button" class="danger" data-delete-product="${esc(product.id)}">Excluir</button>
      </div>
    </article>`).join("") : '<p class="empty-admin">Nenhum produto cadastrado.</p>';
};

const editorBackdrop = $("#imageEditorBackdrop");
const editorCanvas = $("#imageEditorCanvas");
const editorCtx = editorCanvas.getContext("2d");
const editorAspect = $("#editorAspect");
const editorZoom = $("#editorZoom");
const editorX = $("#editorX");
const editorY = $("#editorY");
const zoomValue = $("#zoomValue");

let editorImage = null;
let editorCallback = null;

const aspectValues = {
  "4:3": 4 / 3,
  "1:1": 1,
  "16:9": 16 / 9
};

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

function loadEditorImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    image.src = src;
  });
}

function configureCanvas() {
  if (editorAspect.value === "1:1") {
    editorCanvas.width = 720;
    editorCanvas.height = 720;
  } else if (editorAspect.value === "16:9") {
    editorCanvas.width = 960;
    editorCanvas.height = 540;
  } else {
    editorCanvas.width = 800;
    editorCanvas.height = 600;
  }
}

function drawEditor() {
  if (!editorImage) return;
  configureCanvas();

  const aspect = aspectValues[editorAspect.value] || 4 / 3;
  const zoom = Number(editorZoom.value) || 1;
  const xPos = Number(editorX.value) / 100;
  const yPos = Number(editorY.value) / 100;
  const imageAspect = editorImage.width / editorImage.height;

  let baseWidth;
  let baseHeight;

  if (imageAspect > aspect) {
    baseHeight = editorImage.height;
    baseWidth = baseHeight * aspect;
  } else {
    baseWidth = editorImage.width;
    baseHeight = baseWidth / aspect;
  }

  const cropWidth = baseWidth / zoom;
  const cropHeight = baseHeight / zoom;
  const sourceX = Math.max(0, (editorImage.width - cropWidth) * xPos);
  const sourceY = Math.max(0, (editorImage.height - cropHeight) * yPos);

  editorCtx.clearRect(0, 0, editorCanvas.width, editorCanvas.height);
  editorCtx.fillStyle = "#080808";
  editorCtx.fillRect(0, 0, editorCanvas.width, editorCanvas.height);
  editorCtx.drawImage(
    editorImage,
    sourceX,
    sourceY,
    cropWidth,
    cropHeight,
    0,
    0,
    editorCanvas.width,
    editorCanvas.height
  );

  zoomValue.textContent = `${zoom.toFixed(2)}x`;
}

async function openImageEditor(src, { title = "Editar imagem", aspect = "4:3", onSave } = {}) {
  if (!src) return;
  try {
    editorImage = await loadEditorImage(src);
    editorCallback = onSave || null;
    $("#imageEditorTitle").textContent = title;
    editorAspect.value = aspect;
    editorZoom.value = "1";
    editorX.value = "50";
    editorY.value = "50";
    drawEditor();
    editorBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
  } catch (error) {
    setStatus("#productStatus", error.message, "error");
  }
}

function closeImageEditor() {
  editorBackdrop.hidden = true;
  document.body.style.overflow = "";
  editorImage = null;
  editorCallback = null;
}

[editorAspect, editorZoom, editorX, editorY].forEach((control) => control.addEventListener("input", drawEditor));
$("#closeImageEditor").addEventListener("click", closeImageEditor);
$("#cancelImageEditor").addEventListener("click", closeImageEditor);
editorBackdrop.addEventListener("click", (event) => { if (event.target === editorBackdrop) closeImageEditor(); });

$("#saveImageEditor").addEventListener("click", () => {
  if (!editorImage || !editorCallback) return closeImageEditor();
  const edited = editorCanvas.toDataURL("image/jpeg", 0.76);
  const callback = editorCallback;
  closeImageEditor();
  callback(edited);
});

function syncProductImageUI(label = "Imagem pronta para salvar") {
  const hasImage = Boolean(productImageData);
  $("#productImageTools").hidden = !hasImage;
  $("#productPreview").hidden = !hasImage;
  if (hasImage) {
    $("#productPreviewImage").src = productImageData;
    $("#productFileName").textContent = label;
  } else {
    $("#productFileName").textContent = "JPG, PNG ou WEBP";
  }
}

function syncPromoImageUI(label = "Imagem pronta para publicar") {
  const hasImage = Boolean(promoImageData);
  $("#promoImageTools").hidden = !hasImage;
  $("#promoFileName").textContent = hasImage ? label : "JPG, PNG ou WEBP";
  updatePromoPreview();
}

// Intercepta o seletor padrão e abre o editor antes de salvar a imagem.
$("#productImage").addEventListener("change", async (event) => {
  event.stopImmediatePropagation();
  const file = event.target.files?.[0];
  if (!file) return;
  $("#productFileName").textContent = file.name;
  try {
    const src = await fileToDataUrl(file);
    await openImageEditor(src, {
      title: "Ajustar foto do produto",
      aspect: "4:3",
      onSave: (edited) => {
        productImageData = edited;
        syncProductImageUI(file.name);
        setStatus("#productStatus", "Imagem ajustada. Salve o produto para aplicar.", "ok");
      }
    });
  } catch (error) {
    setStatus("#productStatus", error.message, "error");
  }
}, true);

$("#promoImage").addEventListener("change", async (event) => {
  event.stopImmediatePropagation();
  const file = event.target.files?.[0];
  if (!file) return;
  $("#promoFileName").textContent = file.name;
  try {
    const src = await fileToDataUrl(file);
    await openImageEditor(src, {
      title: "Ajustar foto da promoção",
      aspect: "16:9",
      onSave: (edited) => {
        promoImageData = edited;
        syncPromoImageUI(file.name);
        setStatus("#promoStatus", "Imagem ajustada. Agora é só publicar.", "ok");
      }
    });
  } catch (error) {
    setStatus("#promoStatus", error.message, "error");
  }
}, true);

$("#editProductImage").addEventListener("click", () => {
  if (!productImageData) return;
  openImageEditor(productImageData, {
    title: "Editar foto do produto",
    aspect: "4:3",
    onSave: (edited) => {
      productImageData = edited;
      syncProductImageUI();
      setStatus("#productStatus", "Imagem editada. Salve o produto para aplicar.", "ok");
    }
  });
});

$("#removeProductImage").addEventListener("click", () => {
  productImageData = "";
  $("#productImage").value = "";
  syncProductImageUI();
  setStatus("#productStatus", "Imagem removida. Salve o produto para aplicar.");
});

$("#editPromoImage").addEventListener("click", () => {
  if (!promoImageData) return;
  openImageEditor(promoImageData, {
    title: "Editar foto da promoção",
    aspect: "16:9",
    onSave: (edited) => {
      promoImageData = edited;
      syncPromoImageUI();
      setStatus("#promoStatus", "Imagem editada. Publique para aplicar.", "ok");
    }
  });
});

$("#removePromoImage").addEventListener("click", () => {
  promoImageData = "";
  $("#promoImage").value = "";
  syncPromoImageUI();
  setStatus("#promoStatus", "Imagem removida. Publique para aplicar.");
});

// Mantém os novos controles sincronizados com as funções existentes do painel.
const originalResetProductForm = resetProductForm;
resetProductForm = function () {
  originalResetProductForm();
  syncProductImageUI();
};

const originalLoadPromotion = loadPromotion;
loadPromotion = async function () {
  await originalLoadPromotion();
  syncPromoImageUI(promoImageData ? "Foto atual da promoção" : undefined);
};

$("#productList").addEventListener("click", async (event) => {
  const photoButton = event.target.closest("[data-photo-product]");
  const editButton = event.target.closest("[data-edit-product]");

  if (editButton) {
    setTimeout(() => syncProductImageUI(productImageData ? "Foto atual do produto" : undefined), 0);
  }

  if (!photoButton) return;
  const id = photoButton.dataset.photoProduct;
  const product = products.find((item) => String(item.id) === id);
  if (!product) return;

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/jpeg,image/png,image/webp";
  picker.hidden = true;
  document.body.appendChild(picker);

  picker.addEventListener("change", async () => {
    const file = picker.files?.[0];
    if (!file) return picker.remove();
    try {
      const src = await fileToDataUrl(file);
      await openImageEditor(src, {
        title: `Ajustar foto de ${product.name}`,
        aspect: "4:3",
        onSave: async (edited) => {
          const previousImage = product.image || "";
          products = products.map((item) => String(item.id) === id ? { ...item, image: edited } : item);
          const saved = await saveProducts("Foto do produto atualizada.");
          if (!saved) {
            products = products.map((item) => String(item.id) === id ? { ...item, image: previousImage } : item);
            renderProductList();
          }
        }
      });
    } catch (error) {
      setStatus("#productStatus", error.message || "Não foi possível trocar a foto.", "error");
    } finally {
      picker.remove();
    }
  }, { once: true });

  picker.click();
});

// Explica o erro de armazenamento de forma útil quando o KV ainda não foi conectado.
const storageObserver = new MutationObserver(() => {
  ["#promoStatus", "#productStatus", "#dashboardStatus"].forEach((selector) => {
    const el = $(selector);
    if (!el) return;
    if (el.textContent.includes("Armazenamento ainda não configurado")) {
      el.textContent = "Falta conectar o banco de dados PROMOTIONS no Cloudflare.";
    }
  });
});

["#promoStatus", "#productStatus", "#dashboardStatus"].forEach((selector) => {
  const el = $(selector);
  if (el) storageObserver.observe(el, { childList: true, characterData: true, subtree: true });
});

// Exclusão definitiva da promoção.
const hidePromoButton = $("#hidePromoButton");
const deletePromoButton = document.createElement("button");
deletePromoButton.type = "button";
deletePromoButton.id = "deletePromoButton";
deletePromoButton.className = "secondary-button danger-outline";
deletePromoButton.textContent = "Excluir promoção";
hidePromoButton.insertAdjacentElement("afterend", deletePromoButton);

deletePromoButton.addEventListener("click", async () => {
  const confirmed = confirm("Excluir esta promoção definitivamente? A foto, o título e a descrição serão apagados.");
  if (!confirmed) return;

  deletePromoButton.disabled = true;
  setStatus("#promoStatus", "Excluindo promoção...");

  try {
    await api("/api/promo", { method: "DELETE" });
    promoImageData = "";
    $("#promoTitle").value = "";
    $("#promoDescription").value = "";
    $("#promoImage").value = "";
    $("#promoActive").checked = false;
    syncPromoImageUI();
    $("#preview").hidden = true;
    setStatus("#promoStatus", "Promoção excluída definitivamente.", "ok");
  } catch (error) {
    setStatus("#promoStatus", error.message || "Não foi possível excluir a promoção.", "error");
  } finally {
    deletePromoButton.disabled = false;
  }
});
