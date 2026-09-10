const wppconnect = require('@wppconnect-team/wppconnect');

if (!wppconnect.__pairingPatched) {
  const originalCreate = wppconnect.create.bind(wppconnect);
  wppconnect.create = function patchedCreate(options = {}) {
    const pairingPhone = String(process.env.WPP_PAIRING_PHONE || '').trim();
    const originalCatchLinkCode = options.catchLinkCode;
    const next = {
      ...options,
      autoClose: false,
      tokenStore: 'file',
      puppeteerOptions: {
        ...(options.puppeteerOptions || {}),
        protocolTimeout: Math.max(180000, Number(options?.puppeteerOptions?.protocolTimeout || 0))
      }
    };
    if (pairingPhone) {
      next.phoneNumber = pairingPhone;
      next.catchLinkCode = (code) => {
        const value = String(code || '').replace(/\s+/g, '').trim();
        if (value && typeof process.send === 'function') {
          try { process.send({ type: 'pairing-code', code: value }); } catch (_) {}
        }
        if (typeof originalCatchLinkCode === 'function') {
          try { originalCatchLinkCode(code); } catch (_) {}
        }
      };
    }
    return originalCreate(next);
  };
  wppconnect.__pairingPatched = true;
}
