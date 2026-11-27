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
  distance_km: number;
  train_origin_date: string;
}

export interface Journey {
  id: string;
  departure: string;
  arrival: string;
  duration_min: number;
  transfers: number;
  total_wait_min: number;
  distance_km: number;
  legs: Leg[];
  reasons: Reason[];
  data: { confidence: Confidence; source: string; as_of: string };
}

export interface Freshness {
  status: string;
  as_of?: string;
  age_days?: number;
  trains: number;
  licence?: string;
  confidence?: Confidence;
}

export interface Station {
  code: string;
  name: string;
  state: string;
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
