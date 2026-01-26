
import { supabase } from '@/lib/supabaseClient';

/* ---------- Projects ---------- */
export async function listProjects() {
  const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
export async function getProjectDetails(id) {
  const { data, error } = await supabase.from('projects').select('*, wallet_templates(*)').eq('id', id).single();
  if (error) throw error; return data;
}
export async function createProject(payload) {
    const { data, error: invokeError } = await supabase.functions.invoke('create-project', {
        body: payload,
    });

    if (invokeError) {
        throw new Error(invokeError.message);
    }

    if (data?.error) {
        throw new Error(data.error);
    }
    
    return data;
}
export async function updateProject(id, payload) {
  const { data, error } = await supabase.from('projects').update(payload).eq('id', id).select('*').single();
  if (error) throw error; return data;
}
export async function deleteProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error; return true;
}
export async function uploadProjectLogo(file) {
  const ext = file.name.split('.').pop() || 'png';
  const path = `public/logos/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('project-logos').upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;
  const { data } = supabase.storage.from('project-logos').getPublicUrl(path);
  return { publicUrl: data.publicUrl };
}

/* ---------- Passes ---------- */
export async function getPassDetailsBySlug(slug) {
    const { data, error } = await supabase
        .from('v_passes')
        .select('*')
        .eq('serial_number', slug)
        .single();
    if (error) throw error;
    return data;
}


/* ---------- Members ---------- */
export async function listMembers(projectId) {
  const { data, error } = await supabase.rpc('fn_list_members', { p_project: projectId });
  if (error) throw error;
  return data || [];
}

/* ---------- Locations ---------- */
export async function listLocations(projectId) {
  const { data, error } = await supabase.from('locations').select('*').eq('project_id', projectId).order('label');
  if (error) throw error; return data || [];
}
export async function addLocation(projectId, payload) {
  const { data, error } = await supabase.from('locations')
    .insert({ project_id: projectId, ...payload }).select('*').single();
  if (error) throw error; return data;
}
export async function deleteLocation(id) {
  const { error } = await supabase.from('locations').delete().eq('id', id);
  if (error) throw error; return true;
}

/* ---------- Customers ---------- */
export async function listCustomers(projectId) {
  const { data, error } = await supabase.rpc('fn_list_customers_with_visits', { p_project_id: projectId });
  if (error) throw error; return data || [];
}

/* ---------- Visits ---------- */
export async function listVisits(projectId) {
  const { data, error } = await supabase.rpc('fn_list_visits', { p_project_id: projectId });
  if (error) throw error; return data || [];
}

/* ---------- Scanner & KPIs ---------- */
export async function scannerVisit(projectId, qrData) {
    const { data, error } = await supabase.functions.invoke('scanner-visit', {
        body: { projectId, qrData }
    });
    if (error) throw new Error(error.message);
    if (data.error) throw new Error(data.error);
    return data;
}
export async function getProjectKpis(projectId) {
  const { data, error } = await supabase.rpc('fn_get_project_kpis', { p_project_id: projectId }).single();
  if (error) throw error; return data;
}
export async function getGlobalKpis() {
  const { data, error } = await supabase.rpc('fn_get_global_kpis').single();
  if (error) throw error; return data || {};
}
export async function getGlobalKpisTimeseries(months) {
  const { data, error } = await supabase.rpc('fn_get_global_kpis_timeseries', { p_months: months });
  if (error) throw error; return data || [];
}
export async function getProjectKpisTimeseries(projectId, months) {
  const { data, error } = await supabase.rpc('fn_get_project_kpis_timeseries', { p_project_id: projectId, p_months: months });
  if (error) throw error; return data || [];
}

export async function getProjectAnalytics(projectId, startDate, endDate) {
  const { data, error } = await supabase.rpc('fn_get_project_analytics', {
    p_project_id: projectId,
    p_start_date: startDate.toISOString(),
    p_end_date: endDate.toISOString(),
  }).single();
  if (error) throw error;
  return data;
}


/* ---------- Wallet Config & Templates ---------- */
export async function listWalletTemplates() {
    const { data, error } = await supabase.from('wallet_templates').select('*');
    if (error) throw error;
    return data || [];
}
