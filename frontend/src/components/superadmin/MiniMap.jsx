import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { hasGoogleMapsClientKey, loadGoogleMapsLibraries } from '@/lib/googleMapsLoader';

const DEFAULT_ZOOM = 16;
const DEFAULT_RADIUS_METERS = 100;

const MiniMap = ({
  lat,
  lng,
  radius = DEFAULT_RADIUS_METERS,
  zoom = DEFAULT_ZOOM,
  className = '',
  isActive = true,
  onCoordinateChange = null,
}) => {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const listenersRef = useRef([]);
  const [status, setStatus] = useState('idle');
  const [errorMessage, setErrorMessage] = useState('');

  const numericLat = Number(lat);
  const numericLng = Number(lng);
  const hasValidCoordinates = Number.isFinite(numericLat) && Number.isFinite(numericLng);
  const safeRadius = Number.isFinite(Number(radius)) && Number(radius) > 0
    ? Number(radius)
    : DEFAULT_RADIUS_METERS;

  useEffect(() => {
    return () => {
      listenersRef.current.forEach((listener) => listener?.remove?.());
      listenersRef.current = [];
      if (window.google?.maps?.event) {
        if (markerRef.current) window.google.maps.event.clearInstanceListeners(markerRef.current);
        if (mapRef.current) window.google.maps.event.clearInstanceListeners(mapRef.current);
      }
      markerRef.current = null;
      circleRef.current = null;
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isActive) return;
    if (!hasValidCoordinates) {
      setStatus('idle');
      return;
    }
    if (!hasGoogleMapsClientKey()) {
      setStatus('error');
      setErrorMessage('Configure a chave publica do Google Maps para exibir o mapa.');
      return;
    }

    let cancelled = false;

    const initializeMap = async () => {
      try {
        if (!mapRef.current) {
          setStatus('loading');
          setErrorMessage('');
        }
        await loadGoogleMapsLibraries(['maps']);
        if (cancelled || !mapElementRef.current) return;

        const position = { lat: numericLat, lng: numericLng };

        if (!mapRef.current) {
          mapRef.current = new window.google.maps.Map(mapElementRef.current, {
            center: position,
            zoom,
            clickableIcons: false,
            fullscreenControl: false,
            mapTypeControl: false,
            streetViewControl: false,
          });

          markerRef.current = new window.google.maps.Marker({
            map: mapRef.current,
            position,
            draggable: Boolean(onCoordinateChange),
          });

          circleRef.current = new window.google.maps.Circle({
            map: mapRef.current,
            center: position,
            radius: safeRadius,
            strokeColor: '#7c3aed',
            strokeOpacity: 0.9,
            strokeWeight: 2,
            fillColor: '#7c3aed',
            fillOpacity: 0.18,
          });
        }

        listenersRef.current.forEach((listener) => listener?.remove?.());
        listenersRef.current = [];

        if (mapRef.current && onCoordinateChange) {
          listenersRef.current.push(
            mapRef.current.addListener('click', (event) => {
              const nextLat = event.latLng?.lat?.();
              const nextLng = event.latLng?.lng?.();
              if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
              onCoordinateChange({ lat: nextLat, lng: nextLng });
            }),
          );
        }

        if (markerRef.current) {
          markerRef.current.setDraggable(Boolean(onCoordinateChange));
          if (onCoordinateChange) {
            listenersRef.current.push(
              markerRef.current.addListener('dragend', (event) => {
                const nextLat = event.latLng?.lat?.();
                const nextLng = event.latLng?.lng?.();
                if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
                onCoordinateChange({ lat: nextLat, lng: nextLng });
              }),
            );
          }
        }

        setStatus('ready');
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Nao foi possivel carregar o mapa.');
      }
    };

    initializeMap();

    return () => {
      cancelled = true;
    };
  }, [hasValidCoordinates, isActive, onCoordinateChange, zoom]);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !circleRef.current || !hasValidCoordinates) return;
    const position = { lat: numericLat, lng: numericLng };
    mapRef.current.setCenter(position);
    markerRef.current.setPosition(position);
    circleRef.current.setCenter(position);
  }, [hasValidCoordinates, numericLat, numericLng]);

  useEffect(() => {
    if (!circleRef.current) return;
    circleRef.current.setRadius(safeRadius);
  }, [safeRadius]);

  useEffect(() => {
    if (!mapRef.current || !Number.isFinite(Number(zoom))) return;
    mapRef.current.setZoom(Number(zoom));
  }, [zoom]);

  if (!hasValidCoordinates) {
    return (
      <div className={`rounded-lg border border-border bg-muted h-64 flex items-center justify-center text-sm text-muted-foreground ${className}`}>
        Coordenadas invalidas para o MiniMapa.
      </div>
    );
  }

  if (!isActive) {
    return (
      <div className={`rounded-lg border border-border bg-muted h-64 flex items-center justify-center text-sm text-muted-foreground ${className}`}>
        Abra a confirmacao para carregar o mapa.
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-border overflow-hidden ${className}`}>
      <div className="relative h-64 w-full bg-muted">
        <div ref={mapElementRef} className="h-full w-full" />

        {status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/75 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando mapa...
            </span>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted px-4 text-center text-sm text-muted-foreground">
            {errorMessage || 'Nao foi possivel carregar o mapa.'}
          </div>
        )}
      </div>

      <div className="bg-muted px-3 py-2 text-xs text-muted-foreground flex items-center justify-between gap-2">
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${numericLat},${numericLng}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Abrir no Google Maps
        </a>
        <span>
          {onCoordinateChange
            ? 'Clique ou arraste para ajustar'
            : `Raio: ${Math.round(safeRadius)}m`}
        </span>
      </div>
    </div>
  );
};

export default MiniMap;
