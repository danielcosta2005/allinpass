export function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function buildShortAddress(fullAddress) {
  return normalizeText(fullAddress);
}

export function mapResultToConfirmation(result) {
  if (!result) return null;

  const fullAddress = normalizeText(
    result.addressFull ||
    result.formatted_address ||
    result.display_name ||
    result.address ||
    '',
  );
  const providedShortAddress = normalizeText(result.addressShort || '');
  const shortAddress = providedShortAddress || buildShortAddress(fullAddress);

  return {
    id: result.id,
    addressFull: fullAddress,
    addressShort: shortAddress,
    lat: result.lat,
    lng: result.lng,
    placeId: result.placeId || null,
    partialMatch: Boolean(result.partialMatch ?? result.partial_match),
    locationType: result.locationType || null,
  };
}
