alter table if exists workspace_ui_prefs
  add column if not exists app_logo_asset_id uuid null,
  add column if not exists app_icon_asset_id uuid null,
  add column if not exists favicon_asset_id uuid null,
  add column if not exists pwa_icon_asset_id uuid null,
  add column if not exists nav_logo_asset_id uuid null,
  add column if not exists homepage_brand_asset_id uuid null;

create table if not exists workspace_template_branding (
  org_id text primary key,
  brand_name text null,
  legal_name text null,
  website text null,
  phone text null,
  email text null,
  address_line_1 text null,
  address_line_2 text null,
  city text null,
  state_region text null,
  postcode text null,
  country text null,
  tax_number text null,
  vat_number text null,
  company_registration_number text null,
  default_footer_text text null,
  default_disclaimer_text text null,
  default_terms_url text null,
  default_bank_name text null,
  default_bank_account_name text null,
  default_bank_account_number text null,
  default_bank_iban text null,
  default_bank_bic text null,
  template_primary_color text null,
  template_secondary_color text null,
  template_accent_color text null,
  template_text_color text null,
  primary_logo_asset_id uuid null,
  secondary_logo_asset_id uuid null,
  header_graphic_asset_id uuid null,
  footer_graphic_asset_id uuid null,
  default_background_graphic_asset_id uuid null,
  default_email_banner_asset_id uuid null,
  default_watermark_asset_id uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists branding_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null,
  name text not null,
  reference_key text not null,
  type text not null,
  storage_key text null,
  mime_type text null,
  alt_text text null,
  notes text null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists branding_assets_workspace_reference_key_idx
  on branding_assets (workspace_id, lower(reference_key));

create index if not exists branding_assets_workspace_sort_idx
  on branding_assets (workspace_id, is_active desc, sort_order asc, created_at asc);
