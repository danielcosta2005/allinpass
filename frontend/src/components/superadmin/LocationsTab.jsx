import React, { Suspense, lazy, useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Plus, Loader2, Trash2, Search, RotateCcw, CheckCircle2, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from '@/components/ui/use-toast';
import { listLocations, addLocation, deleteLocation, geocodeAddress } from '@/lib/api';
import {
  ADDRESS_INPUT_PLACEHOLDER,
  DEFAULT_FORM,
  DEFAULT_GEOFENCE_RADIUS_METERS,
  GEOCODE_RESULTS_LIMIT,
  LOCATION_DESCRIPTION_PLACEHOLDER,
} from '@/components/superadmin/locations/constants';
import {
  buildShortAddress,
  mapResultToConfirmation,
  normalizeText,
} from '@/components/superadmin/locations/addressUtils';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const MiniMap = lazy(() => import('@/components/superadmin/MiniMap'));

const LocationsTab = ({
  projectId,
  selectionMode = false,
  selectedLocationIds = [],
  onSelectedLocationIdsChange,
  passId = null,
  onClose = null,
  readOnly = false,
}) => {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isSubmittingLocation, setIsSubmittingLocation] = useState(false);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [formData, setFormData] = useState(DEFAULT_FORM);
  const [searchResults, setSearchResults] = useState([]);
  const [selectedResultId, setSelectedResultId] = useState('');
  const [confirmationData, setConfirmationData] = useState(null);
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [locationToDelete, setLocationToDelete] = useState(null);

  const canSelect = !readOnly && selectionMode && typeof onSelectedLocationIdsChange === 'function';
  const selectedIdsSet = new Set(Array.isArray(selectedLocationIds) ? selectedLocationIds : []);

  const updateSelectedIds = useCallback((nextIds) => {
    if (!canSelect) return;
    onSelectedLocationIdsChange(nextIds);
  }, [canSelect, onSelectedLocationIdsChange]);

  const toggleLocationSelection = useCallback((locationId, checked) => {
    if (!canSelect || !locationId) return;

    const next = new Set(Array.isArray(selectedLocationIds) ? selectedLocationIds : []);
    if (checked) next.add(locationId);
    else next.delete(locationId);

    updateSelectedIds([...next]);
  }, [canSelect, selectedLocationIds, updateSelectedIds]);

  const fetchLocations = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await listLocations(projectId);
      setLocations(data);
    } catch (error) {
      toast({
        title: 'Erro ao carregar locais',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  useEffect(() => {
    if (!isConfirmationOpen) return;
    const selected = searchResults.find((item) => item.id === selectedResultId);
    if (!selected) return;
    setConfirmationData((prev) => {
      if (prev?.id === selected.id) return prev;
      return mapResultToConfirmation(selected);
    });
  }, [isConfirmationOpen, searchResults, selectedResultId]);

  const resetAddressPipeline = useCallback((options = {}) => {
    const {
      keepBaseFields = true,
      addressQuery = '',
    } = options;

    setSearchResults([]);
    setSelectedResultId('');
    setConfirmationData(null);
    setIsConfirmationOpen(false);

    if (!keepBaseFields) {
      setFormData(DEFAULT_FORM);
    } else {
      setFormData((prev) => ({ ...prev, addressQuery }));
    }
  }, []);

  const handleSearchAddress = async (e) => {
    e.preventDefault();
    if (readOnly) return;

    const label = formData.label.trim();
    const addressQuery = formData.addressQuery.trim();

    if (!label) {
      toast({
        title: 'Informe um label',
        description: 'Preencha o nome do local antes de buscar.',
        variant: 'destructive',
      });
      return;
    }

    if (!addressQuery) {
      toast({
        title: 'Informe um endereco',
        description: 'Digite um endereco para buscar as coordenadas.',
        variant: 'destructive',
      });
      return;
    }

    setIsSearchingAddress(true);
    try {
      const results = await geocodeAddress(addressQuery, GEOCODE_RESULTS_LIMIT);
      if (!results.length) {
        setSearchResults([]);
        setSelectedResultId('');
        setConfirmationData(null);
        setIsConfirmationOpen(false);
        toast({
          title: 'Nenhum resultado',
          description: 'Não encontramos esse endereço. Tente refinar a busca.',
          variant: 'destructive',
        });
        return;
      }

      setSearchResults(results);
      setSelectedResultId(results[0].id);
      setConfirmationData(mapResultToConfirmation(results[0]));
      setIsConfirmationOpen(true);
      toast({
        title: 'Endereço encontrado',
        description: `Recebemos ${results.length} opção(ões). Confirme no overlay.`,
      });
    } catch (error) {
      toast({
        title: 'Erro ao consultar endereco',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleRestartAddressFlow = () => {
    const suggestedAddress = confirmationData?.addressFull || '';
    resetAddressPipeline({ keepBaseFields: true, addressQuery: suggestedAddress });
  };

  const handleSubmitConfirmedLocation = async () => {
    if (readOnly) return;
    if (!confirmationData) return;

    setIsSubmittingLocation(true);
    try {
      const trimmedLabel = formData.label.trim();
      const trimmedDescription = formData.description.trim();
      const trimmedAddress = normalizeText(confirmationData.addressFull);
      const lat = Number(confirmationData.lat);
      const lng = Number(confirmationData.lng);
      const radius = DEFAULT_GEOFENCE_RADIUS_METERS;

      if (!trimmedLabel) throw new Error('Label obrigatório.');
      if (!trimmedAddress) throw new Error('Endereço obrigatório.');
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Latitude/longitude inválidas.');

      const createdLocation = await addLocation(
        projectId,
        {
          label: trimmedLabel,
          description: trimmedDescription || LOCATION_DESCRIPTION_PLACEHOLDER,
          address: trimmedAddress,
          lat,
          lng,
          long: lng,
          radius,
        },
        { passId: selectionMode ? passId : null },
      );

      if (canSelect && createdLocation?.id) {
        const next = new Set(Array.isArray(selectedLocationIds) ? selectedLocationIds : []);
        next.add(createdLocation.id);
        updateSelectedIds([...next]);
      }

      toast({
        title: 'Local adicionado',
        description: `${formData.label || 'Novo local'} foi cadastrado com sucesso.`,
      });

      setFormData(DEFAULT_FORM);
      setSearchResults([]);
      setSelectedResultId('');
      setConfirmationData(null);
      setIsConfirmationOpen(false);
      setShowForm(false);
      await fetchLocations();
    } catch (error) {
      toast({
        title: 'Erro ao adicionar local',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingLocation(false);
    }
  };

  const handleDelete = async () => {
    if (readOnly) return;
    if (!locationToDelete) return;

    setIsSubmittingLocation(true);
    try {
      await deleteLocation(locationToDelete.id);

      if (canSelect) {
        const next = (Array.isArray(selectedLocationIds) ? selectedLocationIds : [])
          .filter((id) => id !== locationToDelete.id);
        updateSelectedIds(next);
      }

      toast({ title: 'Local removido', description: `${locationToDelete.label} foi excluído.` });
      setLocationToDelete(null);
      await fetchLocations();
    } catch (error) {
      toast({
        title: 'Erro ao remover',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmittingLocation(false);
    }
  };

  const confirmationLat = Number(confirmationData?.lat);
  const confirmationLng = Number(confirmationData?.lng);
  const geofenceRadius = DEFAULT_GEOFENCE_RADIUS_METERS;
  const selectedSearchResult = searchResults.find((item) => item.id === selectedResultId) || null;
  const minimapLat = Number.isFinite(confirmationLat) ? confirmationLat : Number(selectedSearchResult?.lat);
  const minimapLng = Number.isFinite(confirmationLng) ? confirmationLng : Number(selectedSearchResult?.lng);

  const handleMapCoordinateChange = useCallback((point) => {
    if (readOnly) return;
    if (!point) return;
    const lat = Number(point.lat);
    const lng = Number(point.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    setConfirmationData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lat,
        lng,
      };
    });
  }, [readOnly]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-3">
        <div>
          <h2 className="text-2xl font-bold">
            {selectionMode ? 'Localizações do Passe' : 'Localizações'}
          </h2>
          {selectionMode && (
            <p className="text-sm text-muted-foreground">
              Selecione os locais deste passe. Selecionadas: {selectedIdsSet.size}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectionMode && onClose && (
            <Button type="button" variant="outline" onClick={onClose}>
              Concluir
            </Button>
          )}

          {!readOnly && (
            <Button
              onClick={() => setShowForm(!showForm)}
              className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600"
            >
              <Plus className="w-4 h-4" />
              Novo Local
            </Button>
          )}
        </div>
      </div>

      {!readOnly && showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
        >
          <form onSubmit={handleSearchAddress} className="space-y-4">
            <div>
              <Label htmlFor="label">Nome do Local</Label>
              <Input
                id="label"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                disabled={isSearchingAddress || isSubmittingLocation}
                required
              />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <Label htmlFor="description">Descrição</Label>
                <div className="relative group flex items-center">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center p-1 text-muted-foreground transition hover:text-foreground"
                    aria-label="Informacoes sobre descricao do local"
                  >
                    <Info className="h-4 w-4" />
                  </button>
                  <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-80 rounded-xl border border-border bg-popover p-3 text-left text-xs text-popover-foreground shadow-xl opacity-0 transition duration-75 group-hover:pointer-events-auto group-hover:opacity-100">
                    Esse é o texto que vai aparecer no celular dos clientes que utilizam iPhone quando eles se aproximarem do seu estabelecimento.
                  </div>
                </div>
              </div>
              <Input
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                disabled={isSearchingAddress || isSubmittingLocation}
                placeholder={LOCATION_DESCRIPTION_PLACEHOLDER}
              />
            </div>

            <div>
              <Label htmlFor="addressQuery">Endereço</Label>
              <Input
                id="addressQuery"
                value={formData.addressQuery}
                onChange={(e) => setFormData({ ...formData, addressQuery: e.target.value })}
                disabled={isSearchingAddress || isSubmittingLocation}
                placeholder={ADDRESS_INPUT_PLACEHOLDER}
                required
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={isSearchingAddress || isSubmittingLocation}>
                {isSearchingAddress ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                Buscar Endereço
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => resetAddressPipeline({ keepBaseFields: true })}
                disabled={isSearchingAddress || isSubmittingLocation}
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reiniciar Busca
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setShowForm(false);
                  resetAddressPipeline({ keepBaseFields: false });
                }}
                disabled={isSearchingAddress || isSubmittingLocation}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </motion.div>
      )}

      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {locations.length > 0 ? locations.map((location) => {
            const shortAddress = buildShortAddress(location.address);
            const isSelected = selectedIdsSet.has(location.id);

            return (
              <motion.div
                key={location.id}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={canSelect ? () => toggleLocationSelection(location.id, !isSelected) : undefined}
                className={`rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20 flex justify-between items-start ${canSelect ? 'cursor-pointer transition-colors hover:border-primary/30 hover:bg-accent/30' : ''} ${canSelect && isSelected ? 'ring-2 ring-indigo-400 bg-primary/10' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <div className="bg-primary/10 p-2 rounded-lg">
                    <MapPin className="w-5 h-5 text-primary" />
                  </div>

                  <div className="flex-1">
                    <h3 className="font-bold mb-1">{location.label}</h3>
                    <p className="text-sm text-muted-foreground">
                      {shortAddress || 'Sem endereco salvo'}
                    </p>
                    <p className="text-muted-foreground text-xs mt-2">
                      {(Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lng ?? location.long)))
                        ? `( ${location.lat}, ${location.lng ?? location.long} )`
                        : 'Coordenadas não definidas'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  {canSelect && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked) => toggleLocationSelection(location.id, Boolean(checked))}
                      onClick={(e) => e.stopPropagation()}
                    />
                  )}

                  {!readOnly && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLocationToDelete(location);
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>
              </motion.div>
            );
          }) : (
            <p className="text-muted-foreground col-span-full text-center py-4">
              {selectionMode
                ? readOnly
                  ? 'Nenhuma localização cadastrada.'
                  : 'Nenhuma localização cadastrada. Crie um novo local para vincular ao passe.'
                : 'Nenhuma localização adicionada.'}
            </p>
          )}
        </div>
      )}

      <AlertDialog open={!!locationToDelete} onOpenChange={(open) => !open && setLocationToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar Remoção</AlertDialogTitle>
          </AlertDialogHeader>

          <AlertDialogDescription>
            Tem certeza que deseja remover o local "{locationToDelete?.label}"? Esta ação não pode ser desfeita.
          </AlertDialogDescription>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLocationToDelete(null)} disabled={isSubmittingLocation}>
              Cancelar
            </AlertDialogCancel>
            <Button
              type="button"
              onClick={handleDelete}
              disabled={isSubmittingLocation}
              className="bg-red-600 hover:bg-red-700"
            >
              {isSubmittingLocation && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={isConfirmationOpen}
        onOpenChange={(open) => {
          if (!isSubmittingLocation) setIsConfirmationOpen(open);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Confirmar localização</DialogTitle>
            <DialogDescription>
              Escolha o resultado correto e revise os dados antes de salvar.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-[1fr_340px] items-start">
              <div>
                <Label>Opções retornadas</Label>
                <div className="mt-2 space-y-2 max-h-64 overflow-auto rounded-md border p-2">
                  {searchResults.map((item) => (
                    <label key={item.id} className="flex items-start gap-3 p-2 rounded hover:bg-accent cursor-pointer">
                      <input
                        type="radio"
                        name="geocode-option-modal"
                        checked={selectedResultId === item.id}
                        onChange={() => setSelectedResultId(item.id)}
                        disabled={isSubmittingLocation}
                      />
                      <div>
                        <p className="text-sm font-medium">{buildShortAddress(item.addressShort || item.address)}</p>
                        <p className="text-xs text-muted-foreground">{item.lat}, {item.lng}</p>
                        {item.partialMatch && (
                          <p className="text-xs text-amber-600">Correspondência parcial, confira o ponto no mapa.</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <Label>MiniMapa</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Clique no mapa ou arraste o marcador para ajustar a coordenada.
                </p>
                <Suspense
                  fallback={(
                    <div className="mt-2 rounded-lg border border-border bg-muted h-64 flex items-center justify-center text-sm text-muted-foreground">
                      Carregando mapa...
                    </div>
                  )}
                >
                  {isConfirmationOpen && (
                    <MiniMap
                      className="mt-2"
                      isActive={isConfirmationOpen}
                      lat={minimapLat}
                      lng={minimapLng}
                      radius={geofenceRadius}
                      onCoordinateChange={handleMapCoordinateChange}
                    />
                  )}
                </Suspense>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleRestartAddressFlow}
              disabled={isSubmittingLocation}
            >
              Editar endereço
            </Button>

            <Button type="button" onClick={handleSubmitConfirmedLocation} disabled={isSubmittingLocation}>
              {isSubmittingLocation ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Salvar Localização
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LocationsTab;
