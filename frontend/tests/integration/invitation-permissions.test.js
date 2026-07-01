const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("admin/member invitation and permissions", () => {
  test("admin creation uses email invite instead of direct password creation", () => {
    const functionSource = read("supabase/functions/superadmin-create-admin/index.ts");
    const adminTabSource = read("frontend/src/components/superadmin/AdminTab.jsx");
    const dashboardSource = read("frontend/src/pages/SuperadminDashboard.jsx");

    expect(functionSource).toContain("inviteUserByEmail");
    expect(functionSource).toContain("getInviteOptions(req)");
    expect(functionSource).toContain("/reset-password?flow=invite");
    expect(functionSource).not.toContain("password: cleanPassword");

    expect(adminTabSource).toContain("canManageAdmins");
    expect(adminTabSource).toContain("Enviar convite");
    expect(adminTabSource).not.toContain("Senha (opcional)");

    expect(dashboardSource).toContain("canViewAdmins");
    expect(dashboardSource).toContain("AdminTab canManageAdmins={isSuperadmin}");
  });

  test("project members are invited by gestores and hidden from staff management controls", () => {
    const createMemberSource = read("supabase/functions/admin-create-member/index.ts");
    const updateMemberSource = read("supabase/functions/admin-update-member/index.ts");
    const removeMemberSource = read("supabase/functions/admin-remove-member/index.ts");
    const membersTabSource = read("frontend/src/components/superadmin/MembersTab.jsx");
    const restaurantSource = read("frontend/src/pages/RestaurantDashboard.jsx");

    expect(createMemberSource).toContain("assertCanManageProjectMembers");
    expect(createMemberSource).toContain('membership?.role === "owner"');
    expect(createMemberSource).toContain("inviteUserByEmail");
    expect(createMemberSource).toContain("/reset-password?flow=invite");

    expect(updateMemberSource).toContain("Apenas gestores podem atualizar membros");
    expect(removeMemberSource).toContain("Apenas gestores podem remover membros");

    expect(membersTabSource).toContain("canManageMembers");
    expect(membersTabSource).toContain("{canManageMembers && (");
    expect(membersTabSource).toContain("Enviar convite");

    expect(restaurantSource).toContain("canManageMembers = memberRole === 'owner'");
    expect(restaurantSource).toContain("canManageMembers={canManageMembers}");
  });

  test("staff cannot author rewards through UI or RLS", () => {
    const rewardsSource = read("frontend/src/components/restaurant/RewardsTab.jsx");
    const restaurantSource = read("frontend/src/pages/RestaurantDashboard.jsx");
    const migrationSource = read("supabase/migrations/20260701213616_invitation_and_staff_permissions.sql");

    expect(restaurantSource).toContain("canManageRewards = memberRole === 'owner'");
    expect(restaurantSource).toContain("canManageRewards={canManageRewards}");

    expect(rewardsSource).toContain("canManageRewards = true");
    expect(rewardsSource).toContain("if (!canManageRewards) return");
    expect(rewardsSource).toContain("disabled={!canManageRewards || updatingRewardId === reward.id}");

    expect(migrationSource).toContain("drop policy if exists rewards_insert_project_staff");
    expect(migrationSource).toContain("create policy rewards_insert_project_manager");
    expect(migrationSource).toContain("create policy rewards_update_project_manager");
    expect(migrationSource).toContain("drop policy if exists pm_ins");
    expect(migrationSource).toContain("create policy project_members_insert_project_manager");
  });
});
