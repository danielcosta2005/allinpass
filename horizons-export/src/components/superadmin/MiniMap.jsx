import React, { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

const DEFAULT_ZOOM = 16;
const DEFAULT_RADIUS_METERS = 100;

const defaultMarkerIcon = L.icon({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

L.Marker.prototype.options.icon = defaultMarkerIcon;

function MapViewportSync({ center, zoom }) {
  const map = useMap();
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      map.setView(center, zoom, { animate: false });
      const timeoutId = setTimeout(() => map.invalidateSize(), 0);
      return () => clearTimeout(timeoutId);
    }

    // Preserve current user zoom when coordinates change (click/drag marker).
    map.setView(center, map.getZoom(), { animate: false });
    const timeoutId = setTimeout(() => map.invalidateSize(), 0);
    return () => clearTimeout(timeoutId);
  }, [map, center, zoom]);

  return null;
}

function MapCoordinatePicker({ onCoordinateChange }) {
  useMapEvents({
    click(event) {
      if (!onCoordinateChange) return;
      onCoordinateChange({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
}

const MiniMap = ({
  lat,
  lng,
  radius = DEFAULT_RADIUS_METERS,
  zoom = DEFAULT_ZOOM,
  className = '',
  onCoordinateChange = null,
}) => {
  const hasValidCoordinates = Number.isFinite(lat) && Number.isFinite(lng);
  const safeRadius = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_RADIUS_METERS;
  const center = useMemo(() => [lat, lng], [lat, lng]);
  const markerEventHandlers = useMemo(() => {
    if (!onCoordinateChange) return undefined;
    return {
      dragend: (event) => {
        const newPoint = event.target.getLatLng();
        onCoordinateChange({
          lat: newPoint.lat,
          lng: newPoint.lng,
        });
      },
    };
  }, [onCoordinateChange]);

  if (!hasValidCoordinates) {
    return (
      <div className={`rounded-lg border bg-gray-50 h-64 flex items-center justify-center text-sm text-gray-500 ${className}`}>
        Coordenadas inválidas para o MiniMapa.
      </div>
    );
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        scrollWheelZoom
        className="h-64 w-full"
      >
        <MapViewportSync center={center} zoom={zoom} />
        <MapCoordinatePicker onCoordinateChange={onCoordinateChange} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker
          position={center}
          draggable={Boolean(onCoordinateChange)}
          eventHandlers={markerEventHandlers}
        />
        <Circle
          center={center}
          radius={safeRadius}
          pathOptions={{
            color: '#7c3aed',
            fillColor: '#7c3aed',
            fillOpacity: 0.2,
            weight: 2,
          }}
        />
      </MapContainer>
      <div className="bg-gray-50 px-3 py-2 text-xs text-gray-600 flex items-center justify-between gap-2">
        <a
          href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Abrir no OpenStreetMap
        </a>
        <span>
          {onCoordinateChange
            ? `Clique/arraste para ajustar`
            : `Raio: ${Math.round(safeRadius)}m`}
        </span>
      </div>
    </div>
  );
};

export default MiniMap;
