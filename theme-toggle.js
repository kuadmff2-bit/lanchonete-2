(() => {
  const STORAGE_KEY = "lanchonete-theme-v1";
  const root = document.documentElement;

  function normalize(value) {
    return value === "light" ? "light" : "dark";
  }

  function storedTheme() {
    try {
      return normalize(localStorage.getItem(STORAGE_KEY));
    } catch {
      return "dark";
    }
  }

  function updateButtons() {
    const current = normalize(root.dataset.theme);
    const target = current === "dark" ? "light" : "dark";
    const label = target === "light" ? "Modo claro" : "Modo escuro";
    const icon = target === "light" ? "☀" : "☾";

    document.querySelectorAll("[data-theme-toggle]").forEach((button) => {
      button.innerHTML = `<span aria-hidden="true">${icon}</span><b>${label}</b>`;
      button.setAttribute("aria-label", `Ativar ${label.toLowerCase()}`);
      button.setAttribute("title", `Ativar ${label.toLowerCase()}`);
    });
  }

  function apply(value, persist = true) {
    const theme = normalize(value);
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
    }
    updateButtons();
    window.dispatchEvent(new CustomEvent("appthemechange", { detail: { theme } }));
    return theme;
  }

  apply(storedTheme(), false);

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-theme-toggle]");
    if (!button) return;
    apply(root.dataset.theme === "light" ? "dark" : "light");
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", updateButtons);
  } else {
    updateButtons();
  }

  window.AppTheme = {
    apply,
    get current() { return normalize(root.dataset.theme); }
  };
})();
