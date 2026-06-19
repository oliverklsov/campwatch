export type Watch = {
  id: string;
  user_id: string;
  facility_id: string;
  facility_name: string;
  start_date: string; // YYYY-MM-DD, first night
  end_date: string;   // YYYY-MM-DD, last night
  sites: string[];
  include_fcfs: boolean;
  flex_days: number;        // also match +/- this many days around the window
  weekend_only: boolean;    // only Friday/Saturday nights
  active: boolean;
  created_at: string;
};

export type Opening = { site: string; date: string; status: "Available" | "Open" };

export type FacilityHit = { facilityId: string; name: string; city: string; state: string };
