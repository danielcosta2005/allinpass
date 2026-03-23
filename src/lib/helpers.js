export const getClaimUrl = (projectId) => {
  return `${window.location.origin}/c/${projectId}/me`;
};

export const getGoogleSub = (user) => {
  if (!user) return null;
  // Supabase uses user.id as the unique identifier
  return user.id;
};