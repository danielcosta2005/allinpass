import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MapPin, Plus, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { listLocations, addLocation, deleteLocation } from '@/lib/api';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const LocationsTab = ({ projectId }) => {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({ label: '', lat: '', lng: '', radius: '200' });
  const [locationToDelete, setLocationToDelete] = useState(null);

  const fetchLocations = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await listLocations(projectId);
      setLocations(data);
    } catch (error) {
      toast({
        title: "Erro ao carregar locais",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await addLocation(projectId, {
        label: formData.label,
        lat: formData.lat ? Number(formData.lat) : null,
        lng: formData.lng ? Number(formData.lng) : null,
        radius: Number(formData.radius || 200)
      });
      toast({
        title: "Local adicionado! 📍",
        description: `${formData.label || 'Novo local'} foi cadastrado com sucesso`,
      });
      setFormData({ label: '', lat: '', lng: '', radius: '200' });
      setShowForm(false);
      await fetchLocations();
    } catch (error) {
      toast({
        title: "Erro ao adicionar local",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!locationToDelete) return;
    setIsSubmitting(true);
    try {
      await deleteLocation(locationToDelete.id);
      toast({ title: "Local removido!", description: `${locationToDelete.label} foi excluído.` });
      setLocationToDelete(null);
      await fetchLocations();
    } catch (error) {
      toast({ title: "Erro ao remover", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Localizações</h2>
        <Button
          onClick={() => setShowForm(!showForm)}
          className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600"
        >
          <Plus className="w-4 h-4" />
          Novo Local
        </Button>
      </div>

      {showForm && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100"
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="label">Nome do Local</Label>
              <Input
                id="label"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="lat">Latitude</Label>
                <Input
                  id="lat"
                  type="number"
                  step="any"
                  value={formData.lat}
                  onChange={(e) => setFormData({ ...formData, lat: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <Label htmlFor="lng">Longitude</Label>
                <Input
                  id="lng"
                  type="number"
                  step="any"
                  value={formData.lng}
                  onChange={(e) => setFormData({ ...formData, lng: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="radius">Raio (metros)</Label>
              <Input
                id="radius"
                type="number"
                value={formData.radius}
                onChange={(e) => setFormData({ ...formData, radius: e.target.value })}
                disabled={isSubmitting}
                required
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Adicionar
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
            </div>
          </form>
        </motion.div>
      )}

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {locations.length > 0 ? locations.map((location) => (
            <motion.div
              key={location.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100 flex justify-between items-start"
            >
              <div className="flex items-start gap-3">
                <div className="bg-purple-100 p-2 rounded-lg">
                  <MapPin className="w-5 h-5 text-purple-600" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold mb-1">{location.label}</h3>
                  <p className="text-sm text-gray-600">
                    {location.lat && location.lng ? `${location.lat}, ${location.lng}` : 'Coordenadas não definidas'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Raio: {location.radius}m</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setLocationToDelete(location)}>
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            </motion.div>
          )) : (
            <p className="text-gray-500 col-span-full text-center py-4">Nenhuma localização adicionada.</p>
          )}
        </div>
      )}
      <AlertDialog open={!!locationToDelete} onOpenChange={(open) => !open && setLocationToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirmar Remoção</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogDescription>Tem certeza que deseja remover o local "{locationToDelete?.label}"? Esta ação não pode ser desfeita.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLocationToDelete(null)} disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700">{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default LocationsTab;