(() => {
  const NUMBER = "5592992973832";

  function normalize(value) {
    let digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
    return /^55\d{10,11}$/.test(digits) ? digits : NUMBER;
  }

  function format(value) {
    const digits = normalize(value);
    const local = digits.slice(2);
    const ddd = local.slice(0, 2);
    const number = local.slice(2);
    return number.length === 9
      ? `(${ddd}) ${number.slice(0, 5)}-${number.slice(5)}`
      : `(${ddd}) ${number.slice(0, 4)}-${number.slice(4)}`;
  }

  function apply() {
    const number = normalize(NUMBER);
    window.BUSINESS_WHATSAPP_NUMBER = number;
    document.querySelectorAll("[data-business-whatsapp-link], .whatsapp-mini").forEach((link) => {
      link.href = `https://wa.me/${number}`;
    });
    document.querySelectorAll("[data-business-whatsapp-display]").forEach((el) => {
      el.textContent = format(number);
    });
  }

  window.BusinessContact = { apply, normalize, format };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
  else apply();
})();
