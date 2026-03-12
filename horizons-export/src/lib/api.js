
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
export async function geocodeAddress(address, limit = 5) {
  const query = String(address ?? '').trim();
  if (!query) return [];
  const normalizedLimit = Math.min(Math.max(Number(limit) || 5, 1), 5);

  const { data, error } = await supabase.functions.invoke('geocode-search', {
    body: { address: query, limit: normalizedLimit },
  });

  if (error) throw error;
  if (!data) return [];
  if (data?.ok === false) {
    throw new Error(data?.error || 'Falha ao geocodificar endereço.');
  }

  const rawResults = Array.isArray(data)
    ? data
    : Array.isArray(data.results)
      ? data.results
      : Array.isArray(data.data)
        ? data.data
        : [];

  return rawResults
    .map((item, index) => {
      const lat = Number(item?.lat ?? item?.latitude);
      const lng = Number(item?.lon ?? item?.lng ?? item?.long ?? item?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

      return {
        id: String(item?.place_id ?? item?.id ?? `${lat}:${lng}:${index}`),
        address: String(item?.display_name ?? item?.formatted_address ?? item?.address ?? '').trim(),
        lat,
        lng,
        long: lng,
        raw: item,
      };
    })
    .filter(Boolean);
}
export async function addLocation(projectId, payload) {
  const lat = payload?.lat == null || payload?.lat === '' ? null : Number(payload.lat);
  const lngSource = payload?.lng ?? payload?.long;
  const lng = lngSource == null || lngSource === '' ? null : Number(lngSource);
  const radius = Number(payload?.radius ?? 100);
  const coordinates = {
    lat: Number.isFinite(lat) ? lat : null,
    radius: Number.isFinite(radius) ? radius : 100,
  };
  const longitude = Number.isFinite(lng) ? lng : null;

  let { data, error } = await supabase.from('locations')
    .insert({
      project_id: projectId,
      label: payload?.label ?? null,
      address: payload?.address ?? null,
      ...coordinates,
      lng: longitude,
    }).select('*').single();

  if (error && /column .*lng.* does not exist/i.test(error.message || '')) {
    const retry = await supabase.from('locations')
      .insert({
        project_id: projectId,
        label: payload?.label ?? null,
        address: payload?.address ?? null,
        ...coordinates,
        long: longitude,
      }).select('*').single();

    data = retry.data;
    error = retry.error;
  }

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
