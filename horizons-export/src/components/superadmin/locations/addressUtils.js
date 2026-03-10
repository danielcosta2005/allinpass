const BRAZILIAN_STATES = new Set([
  'Acre',
  'Alagoas',
  'Amapá',
  'Amazonas',
  'Bahia',
  'Ceará',
  'Distrito Federal',
  'Espírito Santo',
  'Goiás',
  'Maranhão',
  'Mato Grosso',
  'Mato Grosso do Sul',
  'Minas Gerais',
  'Pará',
  'Paraíba',
  'Paraná',
  'Pernambuco',
  'Piauí',
  'Rio de Janeiro',
  'Rio Grande do Norte',
  'Rio Grande do Sul',
  'Rondônia',
  'Roraima',
  'Santa Catarina',
  'São Paulo',
  'Sergipe',
  'Tocantins',
]);

export function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function isIgnoredAddressPart(part) {
  return (
    /^Região Geográfica/i.test(part) ||
    /^Região Metropolitana/i.test(part) ||
    /^Brasil$/i.test(part) ||
    /^Brazil$/i.test(part)
  );
}

function isBrazilianPostalCode(part) {
  return /^\d{5}-?\d{3}$/.test(part);
}

function isBrazilianState(part) {
  return /^[A-Z]{2}$/.test(part) || BRAZILIAN_STATES.has(part);
}

export function buildShortAddress(fullAddress) {
  const normalized = normalizeText(fullAddress);
  if (!normalized) return '';

  const parts = normalized
    .split(',')
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .filter((part) => !isIgnoredAddressPart(part));

  if (parts.length <= 1) {
    return normalized;
  }

  let postcode = '';
  let state = '';
  let city = '';
  let neighbourhood = '';

  const mutableParts = [...parts];

  if (mutableParts.length && isBrazilianPostalCode(mutableParts[mutableParts.length - 1])) {
    postcode = mutableParts.pop();
  }

  if (mutableParts.length && isBrazilianState(mutableParts[mutableParts.length - 1])) {
    state = mutableParts.pop();
  }

  if (mutableParts.length) {
    city = mutableParts.pop();
  }

  if (mutableParts.length) {
    neighbourhood = mutableParts.pop();
  }

  const roadAndNumber = mutableParts.join(', ');

  return [
    roadAndNumber,
    neighbourhood,
    city,
    state,
    postcode,
  ]
    .filter(Boolean)
    .join(' - ');
}

export function mapResultToConfirmation(result) {
  if (!result) return null;

  const fullAddress = normalizeText(result.address || '');

  return {
    id: result.id,
    addressFull: fullAddress,
    addressShort: buildShortAddress(fullAddress),
    lat: result.lat,
    lng: result.lng,
  };
}
