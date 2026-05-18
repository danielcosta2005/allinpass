export function isSuperadminRole(role) {
  return role === 'superadmin';
}

export function isAdminRole(role) {
  return role === 'admin';
}

export function canAccessAdminPanel(role) {
  return isSuperadminRole(role) || isAdminRole(role);
}

export function canDeleteProject(role) {
  return isSuperadminRole(role);
}

export function canManageProject({ role, userId, project }) {
  if (isSuperadminRole(role)) return true;
  if (!isAdminRole(role)) return false;

  const createdBy = project?.created_by;
  if (!createdBy || !userId) return false;

  return createdBy === userId;
}

export function canGeneratePass({ role, userId, project }) {
  return canManageProject({ role, userId, project });
}

export function getDefaultAdminTab(role) {
  return isAdminRole(role) ? 'projects' : 'dashboard';
}

export function canSeeSuperadminTabs(role) {
  return isSuperadminRole(role);
}
