export interface Category { name: string; slug: string; icon: string; color: string; count?: number }

export interface EventCardData {
  id: number; title: string; slug: string; short_description: string | null;
  event_date: string; display_date: string; event_time: string | null; end_date: string | null; end_time: string | null;
  image_path: string | null; thumb_path: string | null;
  is_free: boolean; ticket_url: string | null; button_text: string; ticket_price: string | null;
  is_featured: boolean; is_exclusive: boolean; has_ticketing: boolean; status: string;
  views: number; interests: number; venue_name: string | null; venue_area: string | null; venue_slug: string | null; categories: Category[];
}

export interface EventList { items: EventCardData[]; total: number; page: number; pages: number; per_page: number; has_more: boolean }

export interface SiteData {
  today: string;
  weekend: { friday: string; saturday: string; sunday: string };
  filters: { total: number; free: number; categories: Required<Category>[] };
}

export interface Organizer {
  id: number; name: string; slug: string; is_community: boolean; logo_path: string | null; about: string | null; special: string | null;
  features: { icon: string; label: string }[]; categories: Category[];
  contact?: string | null; has_contact?: boolean; social_available?: string[];
  social_instagram?: string | null; social_facebook?: string | null; social_twitter?: string | null; social_whatsapp?: string | null; social_website?: string | null;
}

export interface Me { id: number; whatsapp_number: string; name: string; gender: string | null; dob: string | null; email: string | null; instagram_username: string | null }
