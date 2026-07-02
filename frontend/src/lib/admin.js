import { supabase } from '@/lib/supabaseClient';
import { buildFunctionError } from '@/lib/functionErrors';

async function invokeAndThrow(functionName, payload, fallback = 'Falha ao chamar edge function') {
    const { data, error, response } = await supabase.functions.invoke(functionName, {
        body: payload,
    });

    if (error) {
        throw await buildFunctionError(error, response, fallback);
    }

    if (!data || data.error) {
        throw new Error(data?.error || 'Edge function retornou resposta invalida');
    }

    return data;
}

export async function adminCreateMember({ projectId, email, role }) {
    return invokeAndThrow('admin-create-member', { projectId, email, role });
}

export async function adminUpdateMember({ memberId, invitationId, projectId, role }) {
    return invokeAndThrow('admin-update-member', { memberId, invitationId, projectId, role });
}

export async function adminRemoveMember({ memberId, invitationId, projectId }) {
    return invokeAndThrow('admin-remove-member', { memberId, invitationId, projectId });
}

export async function adminListAdmins() {
    const data = await invokeAndThrow('superadmin-list-admins', {});
    return data.admins || [];
}

export async function adminCreateAdmin({ email, role = 'admin' }) {
    return invokeAndThrow('superadmin-create-admin', { email, role });
}

export async function adminUpdateAdmin({ adminId, invitationId, role }) {
    return invokeAndThrow('superadmin-update-admin', { adminId, invitationId, role });
}

export async function adminResendInvitation({ invitationId }) {
    return invokeAndThrow('admin-resend-invitation', { invitationId });
}

export async function adminAcceptInvitation({ invitationId, nonce, validateOnly } = {}) {
    return invokeAndThrow('admin-accept-invitation', { invitationId, nonce, validateOnly });
}

export async function adminRemoveAdmin({ adminId, invitationId }) {
    return invokeAndThrow('superadmin-remove-admin', { adminId, invitationId });
}
