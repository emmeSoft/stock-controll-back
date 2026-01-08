export const normalizeCuit = (cuit) => {
  if (!cuit) return null;
  return String(cuit).replace(/[^\d]/g, "");
};

export const isValidCuit = (cuit) => {
  if (!cuit) return false;

  const clean = normalizeCuit(cuit);

  if (clean.length !== 11) return false;

  const digits = clean.split("").map(Number);
  const checkDigit = digits.pop();

  const weights = [5,4,3,2,7,6,5,4,3,2];

  const sum = digits.reduce((acc, digit, i) => {
    return acc + digit * weights[i];
  }, 0);

  const mod = 11 - (sum % 11);

  let expected;
  if (mod === 11) expected = 0;
  else if (mod === 10) expected = 9;
  else expected = mod;

  return checkDigit === expected;
};


export const normalizeDni = (dni) => {
  if (!dni) return null;
  return String(dni).replace(/[^\d]/g, "");
};

export const isValidDni = (dni) => {
  if (!dni) return false;

  const clean = normalizeDni(dni);

  if (!/^\d+$/.test(clean)) return false;

  if (clean.length < 7 || clean.length > 8) return false;

  const num = parseInt(clean);
  if (num < 1000000 || num > 99999999) return false;

  return true;
};

export const normalizeEmail = (email) => {
  if (!email) return null;
  return String(email).trim().toLowerCase();
};

export const isValidEmail = (email) => {
  if (!email) return false;

  const clean = normalizeEmail(email);

  // RFC-lite, suficiente para backend real
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  return regex.test(clean);
};


export const normalizeArPhone = (phone) => {
  if (!phone) return null;

  let clean = String(phone).replace(/[^\d]/g, ""); // solo números

  // Quitar +54
  if (clean.startsWith("54")) {
    clean = clean.slice(2);
  }

  // Quitar 0 de larga distancia
  if (clean.startsWith("0")) {
    clean = clean.slice(1);
  }

  // Quitar 15 (prefijo celular)
  if (clean.startsWith("15")) {
    clean = clean.slice(2);
  }

  return clean;
};

export const isValidArPhone = (phone) => {
  if (!phone) return false;

  const clean = normalizeArPhone(phone);

  // Argentina: área (2-4) + número (6-8) → total 10 dígitos
  if (!/^\d{10}$/.test(clean)) return false;

  return true;
};
