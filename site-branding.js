(() => {
  const root = document.documentElement;
  const metaTheme = document.querySelector('meta[name="theme-color"]');

  function hexToRgb(hex) {
    const value = String(hex || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(value)) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16)
    };
  }

  function mix(first, second, amount) {
    const a = hexToRgb(first);
    const b = hexToRgb(second);
    const channel = (key) => Math.round(a[key] * (1 - amount) + b[key] * amount)
      .toString(16).padStart(2, "0");
    return `#${channel("r")}${channel("g")}${channel("b")}`;
  }

  function readableOn(hex) {
    const { r, g, b } = hexToRgb(hex);
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luminance > 0.58 ? "#111111" : "#ffffff";
  }

  function imageCss(value) {
    return `url("${String(value || "").replace(/["\\\n\r]/g, "")}")`;
  }

  function setText(selector, value) {
    document.querySelectorAll(selector).forEach((element) => {
      element.textContent = value;
    });
  }

  function apply(branding) {
    if (!branding) return;
    const primary = branding.primaryColor;
    const accent = branding.accentColor;
    const background = branding.backgroundColor;
    const surface = branding.surfaceColor;
    const text = branding.textColor;
    const darkBackground = readableOn(background) === "#ffffff";
    const variant = branding.styleVariant || root.dataset.brandStyle || "original";

    root.dataset.brandStyle = variant;
    root.style.setProperty("--bg", background);
    root.style.setProperty("--surface", surface);
    root.style.setProperty("--surface2", mix(surface, text, darkBackground ? 0.08 : 0.05));
    root.style.setProperty("--card", surface);
    root.style.setProperty("--card2", mix(surface, background, 0.42));
    root.style.setProperty("--text", text);
    root.style.setProperty("--muted", mix(text, background, 0.45));
    root.style.setProperty("--line", mix(surface, text, darkBackground ? 0.16 : 0.2));
    root.style.setProperty("--orange", primary);
    root.style.setProperty("--green", accent);
    root.style.setProperty("--red", mix("#e34747", text, 0.12));
    root.style.setProperty("--brand-primary", primary);
    root.style.setProperty("--brand-accent", accent);
    root.style.setProperty("--brand-on-primary", readableOn(primary));
    root.style.setProperty("--brand-on-accent", readableOn(accent));

    if (variant === "bold") {
      root.style.setProperty("--blue", primary);
      root.style.setProperty("--blue-deep", mix(primary, "#000000", 0.27));
      root.style.setProperty("--orange", accent);
      root.style.setProperty("--green", accent);
    } else if (variant === "artisan") {
      root.style.setProperty("--wine", primary);
      root.style.setProperty("--orange", primary);
      root.style.setProperty("--gold", accent);
      root.style.setProperty("--mint", accent);
      root.style.setProperty("--green", accent);
    }

    if (metaTheme) metaTheme.content = primary;
    setText("[data-brand-name]", branding.name);
    setText("[data-brand-name-upper]", branding.name.toLocaleUpperCase("pt-BR"));
    setText("[data-brand-subtitle]", branding.subtitle);
    setText("[data-brand-hero-title]", branding.heroTitle);
    setText("[data-brand-hero-text]", branding.heroText);
    setText("[data-brand-admin-title]", `Painel da ${branding.name}`);

    document.querySelectorAll("[data-brand-home-link]").forEach((link) => {
      link.setAttribute("aria-label", `${branding.name} - início`);
    });

    const logo = branding.logo || branding.defaultLogo || "/assets/favicon.svg";
    document.querySelectorAll("[data-brand-logo]").forEach((image) => {
      image.src = logo;
      image.alt = "";
    });
    const favicon = document.querySelector("#siteFavicon");
    if (favicon) {
      favicon.href = logo;
      favicon.type = logo.startsWith("data:image/png") ? "image/png"
        : logo.startsWith("data:image/webp") ? "image/webp" : "image/svg+xml";
    }

    const heroImage = branding.heroImage || branding.defaultHeroImage;
    document.querySelectorAll("[data-brand-hero-image]").forEach((image) => {
      if (heroImage) image.src = heroImage;
    });
    const hero = document.querySelector("[data-brand-hero]");
    if (hero && !hero.querySelector("[data-brand-hero-image]") && heroImage) {
      hero.style.backgroundImage =
        `linear-gradient(90deg,rgba(5,5,5,.92) 0%,rgba(5,5,5,.62) 45%,rgba(5,5,5,.18) 100%),${imageCss(heroImage)}`;
    }

    if (branding.pageBackgroundImage) {
      document.body.classList.add("has-brand-background");
      document.body.style.setProperty("--brand-page-image", imageCss(branding.pageBackgroundImage));
    } else {
      document.body.classList.remove("has-brand-background");
      document.body.style.removeProperty("--brand-page-image");
    }

    const isAdmin = document.body.classList.contains("admin-view");
    document.title = isAdmin
      ? `Admin | ${branding.name}`
      : `${branding.name} | Cardápio`;

    window.SiteBranding.current = branding;
    document.dispatchEvent(new CustomEvent("sitebrandingready", { detail: branding }));
  }

  async function load() {
    try {
      const response = await fetch("/api/branding", { cache: "no-store" });
      if (!response.ok) throw new Error("branding");
      const branding = await response.json();
      apply(branding);
      return branding;
    } catch {
      return null;
    }
  }

  window.SiteBranding = { current: null, apply, load, mix, readableOn };
  window.SiteBranding.ready = load();
})();
