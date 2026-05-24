
import { supabase } from '@/lib/supabaseClient';

function unwrapRpcPayload(payload, functionName) {
	if (Array.isArray(payload)) {
		if (payload.length === 0) return null;
		if (payload.length === 1) return unwrapRpcPayload(payload[0], functionName);
		return payload;
	}

	if (payload && typeof payload === 'object' && functionName && Object.prototype.hasOwnProperty.call(payload, functionName)) {
		return payload[functionName];
	}

	return payload;
}

function coerceJsonPayload(payload) {
	if (typeof payload !== 'string') return payload;
	try {
		return JSON.parse(payload);
	} catch {
		return payload;
	}
}

const PROJECT_ANALYTICS_FALLBACK = {
	kpis: {
		total_customers: 0,
        active_customers_period: 0,
		visits_in_period: 0,
		wallet_linked: 0,
		wallet_active_period: 0,
		rewards_unlocked_period: 0,
	},
	by_day_of_week: [],
	by_day_of_month: [],
	by_hour_of_day: [],
	visits_by_date: [],
	new_vs_returning_customers: {
		new_customers: 0,
		returning_customers: 0,
	},
	visit_frequency_distribution: [],
	rewards_unlocked_period: {
		total: 0,
		by_date: [],
	},
	wallet_installs_by_date: [],
	wallet_removals_by_date: [],
};

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
	const { data, error: invokeError } = await supabase.functions.invoke('create-project-teste', {
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
		throw new Error(data?.userMessage || data?.error || 'Falha ao geocodificar endereço.');
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
			const lat = Number(item?.lat ?? item?.latitude ?? item?.geometry?.location?.lat);
			const lng = Number(item?.lon ?? item?.lng ?? item?.long ?? item?.longitude ?? item?.geometry?.location?.lng);
			if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

			const formattedAddress = String(
				item?.formatted_address ??
				item?.display_name ??
				item?.addressFull ??
				item?.address ??
				'',
			).trim();
			const placeId = item?.placeId ?? item?.place_id ?? null;

			return {
				id: String(placeId ?? item?.id ?? `${lat}:${lng}:${index}`),
				placeId: placeId ? String(placeId) : null,
				address: formattedAddress,
				display_name: String(item?.display_name ?? formattedAddress).trim(),
				formatted_address: formattedAddress,
				addressShort: String(item?.addressShort ?? '').trim(),
				addressFull: String(item?.addressFull ?? formattedAddress).trim(),
				lat,
				lng,
				long: lng,
				partialMatch: Boolean(item?.partialMatch ?? item?.partial_match),
				locationType: item?.locationType ?? item?.geometry?.location_type ?? null,
				raw: item,
			};
		})
		.filter(Boolean);
}
export async function addLocation(projectId, payload, options = {}) {
	const passId =
		typeof options?.passId === 'string' && options.passId.trim()
			? options.passId.trim()
			: null;

	const lat = payload?.lat == null || payload?.lat === '' ? null : Number(payload.lat);
	const lngSource = payload?.lng ?? payload?.long;
	const lng = lngSource == null || lngSource === '' ? null : Number(lngSource);
	const radius = Number(payload?.radius ?? 100);
	const description =
		typeof payload?.description === 'string' && payload.description.trim()
			? payload.description.trim()
			: null;
	const coordinates = {
		lat: Number.isFinite(lat) ? lat : null,
		radius: Number.isFinite(radius) ? radius : 100,
	};
	const longitude = Number.isFinite(lng) ? lng : null;

	let { data, error } = await supabase.from('locations')
		.insert({
			project_id: projectId,
			label: payload?.label ?? null,
			description,
			address: payload?.address ?? null,
			...coordinates,
			lng: longitude,
		}).select('*').single();

	if (error && /column .*lng.* does not exist/i.test(error.message || '')) {
		const retry = await supabase.from('locations')
			.insert({
				project_id: projectId,
				label: payload?.label ?? null,
				description,
				address: payload?.address ?? null,
				...coordinates,
				long: longitude,
			}).select('*').single();

		data = retry.data;
		error = retry.error;
	}

	if (error) throw error;

	if (passId && data?.id) {
		const { error: passLocationError } = await supabase
			.from('pass_locations')
			.upsert(
				{
					project_id: projectId,
					pass_id: passId,
					location_id: data.id,
				},
				{ onConflict: 'pass_id,location_id' },
			);

		if (passLocationError) throw passLocationError;
	}

	return data;
}
export async function deleteLocation(id) {
	const locationId = typeof id === 'string' ? id.trim() : '';
	if (!locationId) throw new Error('Location id obrigatório.');

	const { error: passLocationsError } = await supabase
		.from('pass_locations')
		.delete()
		.eq('location_id', locationId);

	if (
		passLocationsError &&
		!/relation .* does not exist/i.test(passLocationsError.message || '') &&
		!/could not find the table/i.test(passLocationsError.message || '')
	) {
		throw passLocationsError;
	}

	const { error } = await supabase.from('locations').delete().eq('id', locationId);
	if (error) throw error; return true;
}

export async function listPassLocationIds(projectId, passId) {
	if (!projectId || !passId) return [];

	const { data, error } = await supabase
		.from('pass_locations')
		.select('location_id')
		.eq('project_id', projectId)
		.eq('pass_id', passId);

	if (error) throw error;

	return [...new Set((data || []).map((row) => row.location_id).filter(Boolean))];
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
	if (error) throw error;
	return coerceJsonPayload(unwrapRpcPayload(data, 'fn_get_global_kpis')) || {};
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
	});
	if (error) throw error;
	const payload = coerceJsonPayload(unwrapRpcPayload(data, 'fn_get_project_analytics')) || {};
	const newVsReturning = payload.new_vs_returning_customers;
	const rewardsUnlockedPeriod = payload.rewards_unlocked_period;
	return {
		...PROJECT_ANALYTICS_FALLBACK,
		...payload,
		kpis: {
			...PROJECT_ANALYTICS_FALLBACK.kpis,
			...(payload.kpis || {}),
		},
		new_vs_returning_customers: Array.isArray(newVsReturning)
			? newVsReturning
			: {
				...PROJECT_ANALYTICS_FALLBACK.new_vs_returning_customers,
				...(newVsReturning || {}),
			},
		rewards_unlocked_period: Array.isArray(rewardsUnlockedPeriod) || typeof rewardsUnlockedPeriod !== 'object' || rewardsUnlockedPeriod === null
			? rewardsUnlockedPeriod ?? PROJECT_ANALYTICS_FALLBACK.rewards_unlocked_period
			: {
				...PROJECT_ANALYTICS_FALLBACK.rewards_unlocked_period,
				...rewardsUnlockedPeriod,
			},
	};
}


/* ---------- Wallet Config & Templates ---------- */
export async function listWalletTemplates() {
	const { data, error } = await supabase.from('wallet_templates').select('*');
	if (error) throw error;
	return data || [];
}
