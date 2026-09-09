(() => {
  const form = document.querySelector("#brandingForm");
  if (!form) return;

  const fields = {
    name: document.querySelector("#brandName"),
    subtitle: document.querySelector("#brandSubtitle"),
    heroTitle: document.querySelector("#brandHeroTitle"),
    heroText: document.querySelector("#brandHeroText"),
    primaryColor: document.querySelector("#brandPrimary"),
    accentColor: document.querySelector("#brandAccent"),
    backgroundColor: document.querySelector("#brandBackground"),
    surfaceColor: document.querySelector("#brandSurface"),
    textColor: document.querySelector("#brandText")
  };

  const images = {
    logo: {
      input: document.querySelector("#brandLogoInput"),
      preview: document.querySelector("#brandLogoPreview"),
      empty: document.querySelector("#brandLogoEmpty"),
      remove: document.querySelector("#removeBrandLogo"),
      filename: document.querySelector("#brandLogoFileName"),
      maxSide: 256,
      quality: 0.82
    },
    heroImage: {
      input: document.querySelector("#brandHeroInput"),
      preview: document.querySelector("#brandHeroPreview"),
      empty: document.querySelector("#brandHeroEmpty"),
      remove: document.querySelector("#removeBrandHero"),
      filename: document.querySelector("#brandHeroFileName"),
      maxSide: 1200,
      quality: 0.72
    },
    pageBackgroundImage: {
      input: document.querySelector("#brandBackgroundInput"),
      preview: document.querySelector("#brandBackgroundPreview"),
      empty: document.querySelector("#brandBackgroundEmpty"),
      remove: document.querySelector("#removeBrandBackground"),
      filename: document.querySelector("#brandBackgroundFileName"),
      maxSide: 1400,
      quality: 0.62
    }
  };

  let branding = null;

  function status(message, type = "") {
    const element = document.querySelector("#brandingStatus");
    element.textContent = message;
    element.className = `status ${type}`.trim();
  }

  async function compress(file, maxSide, quality) {
    const source = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Não foi possível ler essa imagem."));
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Escolha uma imagem JPG, PNG ou WEBP válida."));
      element.src = source;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const webp = canvas.toDataURL("image/webp", quality);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", quality);
  }

  function imageSource(key) {
    if (!branding) return "";
    if (branding[key]) return branding[key];
    if (key === "logo") return branding.defaultLogo || "/assets/favicon.svg";
    if (key === "heroImage") return branding.defaultHeroImage || "";
    return "";
  }

  function renderImage(key) {
    const config = images[key];
    const source = imageSource(key);
    config.preview.hidden = !source;
    config.empty.hidden = Boolean(source);
    if (source) config.preview.src = source;
    config.remove.hidden = !branding?.[key];
    config.filename.textContent = branding?.[key] ? "Imagem personalizada pronta" : "Usando a imagem original";
  }

  function collectTextAndColors() {
    const next = { ...branding };
    Object.entries(fields).forEach(([key, input]) => {
      next[key] = input.value.trim();
    });
    return next;
  }

  function renderMiniPreview() {
    if (!branding) return;
    const preview = document.querySelector("#brandLivePreview");
    const name = document.querySelector("#brandPreviewName");
    const subtitle = document.querySelector("#brandPreviewSubtitle");
    const logo = document.querySelector("#brandPreviewLogo");
    const hero = document.querySelector("#brandPreviewHero");
    const heroTitle = document.querySelector("#brandPreviewHeroTitle");
    const values = collectTextAndColors();

    preview.style.setProperty("--preview-primary", values.primaryColor);
    preview.style.setProperty("--preview-accent", values.accentColor);
    preview.style.setProperty("--preview-bg", values.backgroundColor);
    preview.style.setProperty("--preview-surface", values.surfaceColor);
    preview.style.setProperty("--preview-text", values.textColor);
    name.textContent = values.name || "Nome da lanchonete";
    subtitle.textContent = values.subtitle || "Cardápio digital";
    heroTitle.textContent = values.heroTitle || "Seu título principal";
    logo.src = imageSource("logo");
    hero.style.backgroundImage = imageSource("heroImage") ? `url("${imageSource("heroImage")}")` : "none";
  }

  function fill(data) {
    branding = { ...data };
    Object.entries(fields).forEach(([key, input]) => {
      input.value = branding[key] || "";
    });
    Object.keys(images).forEach(renderImage);
    renderMiniPreview();
  }

  Object.values(fields).forEach((input) => input.addEventListener("input", renderMiniPreview));

  Object.entries(images).forEach(([key, config]) => {
    config.input.addEventListener("change", async () => {
      const file = config.input.files?.[0];
      if (!file) return;
      status("Preparando a imagem...");
      try {
        branding[key] = await compress(file, config.maxSide, config.quality);
        renderImage(key);
        renderMiniPreview();
        status("Imagem pronta. Toque em Salvar aparência para publicar.", "ok");
      } catch (error) {
        status(error.message, "error");
      } finally {
        config.input.value = "";
      }
    });

    config.remove.addEventListener("click", () => {
      branding[key] = "";
      renderImage(key);
      renderMiniPreview();
      status("Imagem removida da prévia. Salve para publicar.");
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const saveButton = document.querySelector("#saveBranding");
    saveButton.disabled = true;
    status("Salvando aparência...");
    try {
      const payload = collectTextAndColors();
      const data = await api("/api/branding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      fill(data);
      if (window.SiteBranding) window.SiteBranding.apply(data);
      status("Aparência publicada no site.", "ok");
    } catch (error) {
      status(error.message || "Não foi possível salvar a aparência.", "error");
    } finally {
      saveButton.disabled = false;
    }
  });

  document.querySelector("#resetBranding").addEventListener("click", async () => {
    if (!confirm("Restaurar nome, textos, imagens e cores originais deste site?")) return;
    status("Restaurando o visual original...");
    try {
      const data = await api("/api/branding", { method: "DELETE" });
      fill(data);
      if (window.SiteBranding) window.SiteBranding.apply(data);
      status("Visual original restaurado.", "ok");
    } catch (error) {
      status(error.message || "Não foi possível restaurar o visual.", "error");
    }
  });

  (async () => {
    const initial = await (window.SiteBranding?.ready || Promise.resolve(null));
    if (initial) {
      fill(initial);
      return;
    }
    try {
      const response = await fetch("/api/branding", { cache: "no-store" });
      if (!response.ok) throw new Error();
      fill(await response.json());
    } catch {
      status("Não foi possível carregar as opções de aparência.", "error");
    }
  })();
})();
