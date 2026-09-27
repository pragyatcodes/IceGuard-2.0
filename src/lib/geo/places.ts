/** Curated info shown in the right panel when a station / port pin is clicked. */
export interface PlaceInfo {
  id: string;
  kind: "station" | "port";
  name: string;
  lat: number;
  lon: number;
  tagline: string;
  facts: { label: string; value: string }[];
}

export const PLACES: PlaceInfo[] = [
  {
    id: "bharati",
    kind: "station",
    name: "Bharati Station",
    lat: -69.4,
    lon: 76.1,
    tagline: "Indian research station · Larsemann Hills, Prydz Bay",
    facts: [
      { label: "Operator", value: "India — NCPOR / MoES" },
      { label: "Established", value: "2012 (31st ISEA), commissioned 2015" },
      { label: "Coordinates", value: "69°24′S 76°11′E" },
      { label: "Region", value: "Larsemann Hills, Princess Elizabeth Land" },
      { label: "Access", value: "Ship via Prydz Bay; air only via Maitri" },
      { label: "Key science", value: "Geodesy, glacial isostasy, meteorology" },
    ],
  },
  {
    id: "maitri",
    kind: "station",
    name: "Maitri Station",
    lat: -70.8,
    lon: 11.7,
    tagline: "Indian research station · Schirmacher Oasis, Dronning Maud Land",
    facts: [
      { label: "Operator", value: "India — NCPOR / MoES" },
      { label: "Established", value: "1989 (succeeded Dakshin Gangotri)" },
      { label: "Coordinates", value: "70°46′S 11°44′E" },
      { label: "Region", value: "Schirmacher Oasis, central Dronning Maud Land" },
      { label: "Access", value: "Ship anchors at India Bay (~120 km convoy); air via Novo / DROMLAN" },
      { label: "Key science", value: "Geomagnetism, seismology, atmospheric sciences" },
    ],
  },
  {
    id: "capetown",
    kind: "port",
    name: "Cape Town Port",
    lat: -33.9,
    lon: 18.4,
    tagline: "ISEA mother port — charter transect Cape Town → Bharati → Maitri → Cape Town",
    facts: [
      { label: "Role", value: "Departure / return port for Indian Antarctic expeditions" },
      { label: "Coordinates", value: "33°54′S 18°25′E" },
      { label: "Leg I", value: "Cape Town → Bharati · 10–12 days" },
      { label: "Leg II", value: "Bharati → Maitri · 5–7 days" },
      { label: "Leg III", value: "Maitri → Cape Town · 8–12 days" },
    ],
  },
];
