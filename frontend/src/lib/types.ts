export type Confidence = "simulated" | "scheduled" | "estimated" | "verified";

export interface Reason {
  code: string;
  text: string;
  minutes?: number;
  station?: string;
  count?: number;
}

export interface Leg {
  train_number: string;
  train_name: string;
  train_kind: string;
  classes: string[];
  from: string;
  from_name: string;
  to: string;
  to_name: string;
  departure: string;
  arrival: string;
  duration_min: number;
  /** null when the source timetable does not publish the distance for this section */
  distance_km: number | null;
  train_origin_date: string;
  /** false when the source timetable has no days of operation */
  running_days_known?: boolean;
}

export interface Journey {
  id: string;
  departure: string;
  arrival: string;
  duration_min: number;
  transfers: number;
  total_wait_min: number;
  distance_km: number | null;
  legs: Leg[];
  reasons: Reason[];
  warnings?: { code: string; text: string }[];
  data: JourneyData;
}

/** Where a journey's times come from. `confidence` is the data label shown on every result. */
export interface JourneyData {
  confidence: Confidence;
  source: string;
  as_of: string;
  source_name?: string;
  source_url?: string;
  imported_at?: string | null;
  freshness?: "recent" | "aging" | "outdated";
  outdated?: boolean;
  warning?: string | null;
}

/** The timetable behind search results: label, provenance and age. */
export interface Freshness {
  status: string;
  label?: "simulated" | "scheduled";
  confidence?: Confidence;
  provider?: string;
  dataset?: string;
  source_name?: string;
  source_url?: string | null;
  official?: boolean;
  licence?: string;
  licence_url?: string | null;
  as_of?: string;
  published_on?: string;
  published_note?: string | null;
  imported_at?: string | null;
  age_days?: number;
  outdated?: boolean;
  warning?: string | null;
  trains: number;
  rows?: number | null;
  running_days_known?: boolean;
  max_transfers?: number;
}

export interface Station {
  code: string;
  name: string;
  state: string | null;
  lat?: number | null;
  lon?: number | null;
  google_maps_url?: string;
}

export interface BookingEvent {
  event: string;
  from: string | null;
  to: string;
  actor: string;
  note: string | null;
  at: string;
}

export interface Booking {
  id: string;
  status: string;
  provider: string;
  provider_mode: string;
  pnr: string | null;
  quota: string;
  travel_class: string;
  from: string;
  to: string;
  journey_date: string;
  departure_at: string;
  journey: Journey;
  group_id: string | null;
  fare_paise: number;
  service_charge_paise: number;
  total_paise: number;
  failure_reason: string | null;
  created_at: string;
  passengers: { id: string; name: string; age_band: string; status: string; coach: string | null; berth: string | null }[];
  events: BookingEvent[];
  payments: { id: string; reference: string; amount_paise: number; status: string; mode: string }[];
  refunds: { id: string; amount_paise: number; status: string; timeline: { status: string; note: string; at: string }[] }[];
  allowed_actions: string[];
}

export interface GroupMember {
  id: string;
  name: string;
  family: string;
  is_minor: boolean;
  berth_preference: string | null;
  role: string;
  linked_account: boolean;
}

export interface Group {
  id: string;
  name: string;
  from: string | null;
  to: string | null;
  journey_date: string | null;
  is_owner: boolean;
  members: GroupMember[];
}

export interface BatchPlan {
  quota: string;
  cap: number;
  cap_source: { url: string; verified_at: string; note: string | null };
  batches: { member_id: string; name: string; family: string; is_minor: boolean }[][];
  families_split: string[];
  warnings: string[];
  explanation: string[];
}
