import React from "react";

const PROD_ORIGIN = 'https://carteira49.com';

export function fillTemplate(tpl, projectId, googleSub) {
  if (!tpl) return '';
  
  let finalUrl = tpl.replaceAll('{projectId}', projectId);

  if (!googleSub || googleSub.includes('{') || googleSub === 'me') {
    finalUrl = finalUrl.replace('/{googleSub}', '/me');
  } else {
    finalUrl = finalUrl.replaceAll('{googleSub}', googleSub);
  }
  
  // Garante que o domínio de produção seja usado, independentemente do template
  if (!finalUrl.startsWith('http')) {
    return `${PROD_ORIGIN}${finalUrl}`;
  }

  const urlObject = new URL(finalUrl);
  if (urlObject.origin !== PROD_ORIGIN) {
    urlObject.host = new URL(PROD_ORIGIN).host;
    urlObject.protocol = new URL(PROD_ORIGIN).protocol;
    return urlObject.toString();
  }
  
  return finalUrl;
}