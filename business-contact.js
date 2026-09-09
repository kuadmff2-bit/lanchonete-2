(() => {
  const FALLBACK_NUMBER = "5592992973832";
  window.BUSINESS_WHATSAPP_NUMBER = FALLBACK_NUMBER;

  function normalize(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return /^55\d{10,11}$/.test(digits) ? digits : "";
  }

  function format(value) {
    const digits = normalize(value);
    if (!digits) return "";
    const local = digits.slice(2);
    const ddd = local.slice(0, 2);
    const number = local.slice(2);
    if (number.length === 9) return `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`;
    return `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }

  function apply(number, display) {
    const normalized = normalize(number) || FALLBACK_NUMBER;
    window.BUSINESS_WHATSAPP_NUMBER = normalized;

    document.querySelectorAll('[data-business-whatsapp-link], .whatsapp-mini').forEach((link) => {
      link.href = `https://wa.me/${normalized}`;
    });

    document.querySelectorAll('[data-business-whatsapp-display]').forEach((el) => {
      el.textContent = display || format(normalized);
    });

    window.dispatchEvent(new CustomEvent('business-whatsapp-updated', {
      detail: { whatsappNumber: normalized, whatsappDisplay: display || format(normalized) }
    }));
  }

  async function load() {
    try {
      const response = await fetch('/api/business-contact', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Falha ao carregar contato');
      apply(data.whatsappNumber, data.whatsappDisplay);
    } catch (_) {
      apply(FALLBACK_NUMBER, format(FALLBACK_NUMBER));
    }
  }

  window.BusinessContact = { load, apply, normalize, format };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load);
  else load();
})();
