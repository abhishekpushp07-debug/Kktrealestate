"""Allow-listed response models for core entities (fields observed on the live API; anything else is dropped at the edge)."""
from typing import Any

from pydantic import BaseModel, ConfigDict


class _Out(BaseModel):
    model_config = ConfigDict(extra="ignore")

class ProjectsOut(_Out):
    load_test: Any = None
    cancellation_policy: Any = None
    bounce_policy: Any = None
    _links: Any = None
    active_rate_card: Any = None
    address: Any = None
    amenities: Any = None
    amenity_ids: Any = None
    approvals: Any = None
    block: Any = None
    block_count: Any = None
    blocks: Any = None
    bookings: Any = None
    code: Any = None
    company_id: Any = None
    construction_stage_sequence: Any = None
    count: Any = None
    cover_image_url: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    default_cash_percent: Any = None
    deleted_at: Any = None
    description: Any = None
    escrow_bank_account_id: Any = None
    expected_possession_date: Any = None
    flat: Any = None
    geo: Any = None
    id: Any = None
    inventory: Any = None
    is_active: Any = None
    is_published: Any = None
    land_area_sqft: Any = None
    landmarks: Any = None
    launch_date: Any = None
    meta: Any = None
    milestone_template: Any = None
    milestone_template_id: Any = None
    name: Any = None
    parking: Any = None
    phases: Any = None
    plan: Any = None
    project: Any = None
    project_type: Any = None
    rera_number: Any = None
    show_availability: Any = None
    show_prices: Any = None
    status: Any = None
    team: Any = None
    team_members: Any = None
    total_towers: Any = None
    total_units: Any = None
    unit_counts: Any = None
    updated_at: Any = None
    version: Any = None
    website: Any = None

class ProjectsOutPage(_Out):
    items: list[ProjectsOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class BlocksOut(_Out):
    _links: Any = None
    block: Any = None
    block_type_id: Any = None
    block_type_name: Any = None
    bookings: Any = None
    code: Any = None
    company_id: Any = None
    construction_percent: Any = None
    construction_stage_sequence: Any = None
    construction_stages: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    default_cash_percent: Any = None
    deleted_at: Any = None
    description: Any = None
    flat: Any = None
    flats_per_floor: Any = None
    floor_labels: Any = None
    floor_plans: Any = None
    floor_rise_per_sqft: Any = None
    floor_start: Any = None
    floors: Any = None
    ground_floor_label: Any = None
    id: Any = None
    inventory: Any = None
    is_active: Any = None
    meta: Any = None
    milestone_template: Any = None
    milestone_template_id: Any = None
    milestones: Any = None
    name: Any = None
    numbering_pattern: Any = None
    plan: Any = None
    podium_floors: Any = None
    position_flat_types: Any = None
    project: Any = None
    project_code: Any = None
    project_id: Any = None
    project_name: Any = None
    rate_per_sqft: Any = None
    refuge_floors: Any = None
    skip_floors: Any = None
    status: Any = None
    unit_counts: Any = None
    unit_floors: Any = None
    updated_at: Any = None
    version: Any = None

class BlocksOutPage(_Out):
    items: list[BlocksOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class FlatsOut(_Out):
    _links: Any = None
    inventory_state: Any = None
    display_state: Any = None
    display_override: Any = None
    display_reason: Any = None
    display_set_at: Any = None
    masked: Any = None
    allocation_category_id: Any = None
    allocation_category_code: Any = None
    bookable: Any = None
    hold: Any = None
    block: Any = None
    areas_snapshot: Any = None
    block_code: Any = None
    block_id: Any = None
    block_name: Any = None
    booking_id: Any = None
    bookings: Any = None
    builtup_sqft: Any = None
    carpet_sqft: Any = None
    company_id: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    deleted_at: Any = None
    facing: Any = None
    flat: Any = None
    flat_number: Any = None
    flat_type: Any = None
    flat_type_code: Any = None
    flat_type_id: Any = None
    floor: Any = None
    floor_label: Any = None
    id: Any = None
    is_active: Any = None
    is_corner: Any = None
    meta: Any = None
    notes: Any = None
    plan: Any = None
    position: Any = None
    price: Any = None
    price_breakup: Any = None
    price_paise: Any = None
    project: Any = None
    project_code: Any = None
    project_id: Any = None
    project_name: Any = None
    rate_card_id: Any = None
    rate_per_sqft: Any = None
    rooms_snapshot: Any = None
    specifications: Any = None
    status: Any = None
    status_changed_at: Any = None
    status_changed_by: Any = None
    status_reason: Any = None
    super_builtup_sqft: Any = None
    updated_at: Any = None
    version: Any = None

class FlatsOutPage(_Out):
    items: list[FlatsOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class CustomersOut(_Out):
    _links: Any = None
    aadhaar: Any = None
    aadhaar_masked: Any = None
    address_current: Any = None
    address_permanent: Any = None
    agreement_paise: Any = None
    alt_phone: Any = None
    annual_income_band: Any = None
    assigned_sales_user_id: Any = None
    bank: Any = None
    bank_account: Any = None
    block: Any = None
    bookings: Any = None
    bookings_count: Any = None
    city_id: Any = None
    co_applicants: Any = None
    company_id: Any = None
    company_name: Any = None
    consent: Any = None
    preferred_channel: Any = None
    preferred_language: Any = None
    whatsapp_phone: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    customer_code: Any = None
    date_of_birth: Any = None
    deleted_at: Any = None
    dob: Any = None
    email: Any = None
    engagement_score: Any = None
    erase_reason: Any = None
    erased_at: Any = None
    erased_by: Any = None
    father_name: Any = None
    father_or_spouse_name: Any = None
    flat: Any = None
    full_name: Any = None
    gender: Any = None
    gender_id: Any = None
    id: Any = None
    income_band_id: Any = None
    is_active: Any = None
    kyc_status: Any = None
    kyc_verified_at: Any = None
    kyc_verified_by: Any = None
    last_contacted_at: Any = None
    lead_id: Any = None
    leads: Any = None
    legacy_income_band: Any = None
    legacy_occupation: Any = None
    legacy_source: Any = None
    lifecycle_stage: Any = None
    locality_id: Any = None
    meta: Any = None
    nominee: Any = None
    notes: Any = None
    occupation: Any = None
    occupation_id: Any = None
    overdue_count: Any = None
    pan: Any = None
    pan_hash: Any = None
    pan_masked: Any = None
    permanent_same_as_current: Any = None
    phone: Any = None
    plan: Any = None
    preferences: Any = None
    profile_migrated: Any = None
    project: Any = None
    residency_id: Any = None
    rm_user_id: Any = None
    salutation: Any = None
    salutation_id: Any = None
    segment_ids: Any = None
    source: Any = None
    source_id: Any = None
    state_id: Any = None
    tags: Any = None
    total_due: Any = None
    total_due_paise: Any = None
    updated_at: Any = None
    updated_via_portal_at: Any = None
    version: Any = None

class CustomersOutPage(_Out):
    items: list[CustomersOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class BookingsOut(_Out):
    transfers: Any = None
    lead_id: Any = None
    refund: Any = None
    transfer: Any = None
    rebind: Any = None
    _links: Any = None
    account_agreed: Any = None
    account_agreed_paise: Any = None
    agreement_revisions: Any = None
    agreement_value: Any = None
    agreement_value_paise: Any = None
    block: Any = None
    block_code: Any = None
    block_id: Any = None
    block_milestones: Any = None
    block_name: Any = None
    booking_date: Any = None
    booking_number: Any = None
    bookings: Any = None
    broker_name: Any = None
    cancellation: Any = None
    cash_agreed: Any = None
    cash_agreed_paise: Any = None
    co_applicant_customer_ids: Any = None
    co_applicants: Any = None
    company_id: Any = None
    completed_at: Any = None
    completed_by: Any = None
    completion_notes: Any = None
    construction_percent: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    customer_code: Any = None
    customer_id: Any = None
    customer_name: Any = None
    customer_phone: Any = None
    deleted_at: Any = None
    demands: Any = None
    flat: Any = None
    flat_id: Any = None
    flat_snapshot: Any = None
    id: Any = None
    is_active: Any = None
    lead_id: Any = None
    ledger_rebuilt_at: Any = None
    meta: Any = None
    milestone_template_snapshot: Any = None
    other_charges: Any = None
    parking_slot_ids: Any = None
    parking_slots: Any = None
    payment_plan_id: Any = None
    payment_plan_snapshot: Any = None
    payments: Any = None
    plan: Any = None
    plan_acceptance: Any = None
    project: Any = None
    project_code: Any = None
    project_id: Any = None
    project_name: Any = None
    raised_percent: Any = None
    rate_per_sqft: Any = None
    remarks: Any = None
    sales_user_id: Any = None
    status: Any = None
    summary: Any = None
    updated_at: Any = None
    version: Any = None

class BookingsOutPage(_Out):
    items: list[BookingsOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class PaymentsOut(_Out):
    _links: Any = None
    customer_name_current: Any = None
    against: Any = None
    amount: Any = None
    amount_paise: Any = None
    bank_account_id: Any = None
    bank_account_name: Any = None
    block: Any = None
    block_code: Any = None
    block_id: Any = None
    booking_id: Any = None
    booking_number: Any = None
    bookings: Any = None
    bounce_reason: Any = None
    bounced_at: Any = None
    cleared_at: Any = None
    cleared_by: Any = None
    company_id: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    customer_id: Any = None
    customer_name: Any = None
    deleted_at: Any = None
    flat: Any = None
    flat_id: Any = None
    flat_number: Any = None
    id: Any = None
    idempotency_key: Any = None
    instrument: Any = None
    is_active: Any = None
    meta: Any = None
    other_charge_line_id: Any = None
    other_charge_name: Any = None
    payment_category: Any = None
    payment_date: Any = None
    payment_mode_code: Any = None
    payment_mode_id: Any = None
    payment_mode_name: Any = None
    plan: Any = None
    posted_at: Any = None
    project: Any = None
    project_code: Any = None
    project_id: Any = None
    receipt_cancelled: Any = None
    receipt_number: Any = None
    received_by: Any = None
    received_by_name: Any = None
    remarks: Any = None
    reversal: Any = None
    status: Any = None
    updated_at: Any = None
    version: Any = None

class PaymentsOutPage(_Out):
    items: list[PaymentsOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class UsersOut(_Out):
    _links: Any = None
    block: Any = None
    bookings: Any = None
    company_id: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    deleted_at: Any = None
    email: Any = None
    failed_attempts: Any = None
    flat: Any = None
    id: Any = None
    is_active: Any = None
    last_login_at: Any = None
    locked_until: Any = None
    meta: Any = None
    mfa_enabled: Any = None
    mfa_enabled_at: Any = None
    mfa_temp_secret: Any = None
    must_change_password: Any = None
    name: Any = None
    password_history: Any = None
    phone: Any = None
    plan: Any = None
    project: Any = None
    project_scope: Any = None
    role_id: Any = None
    role_name: Any = None
    updated_at: Any = None
    version: Any = None

class UsersOutPage(_Out):
    items: list[UsersOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class CataloguesOut(_Out):
    types: Any = None
    version: Any = None
    customer: Any = None
    flat: Any = None
    block: Any = None
    project: Any = None
    plan: Any = None
    bookings: Any = None
    _links: Any = None
    meta: Any = None
    count: Any = None


class CataloguesOutPage(_Out):
    items: list[CataloguesOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class LeadsOut(_Out):
    booking_id: Any = None
    converted_customer_id: Any = None
    _links: Any = None
    activities: Any = None
    assigned_to: Any = None
    block: Any = None
    bookings: Any = None
    budget_max: Any = None
    budget_min: Any = None
    company_id: Any = None
    converted_customer_id: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    deleted_at: Any = None
    email: Any = None
    flat: Any = None
    flat_id: Any = None
    flat_number: Any = None
    flat_type_id: Any = None
    follow_ups: Any = None
    id: Any = None
    ip: Any = None
    is_active: Any = None
    is_read: Any = None
    lead_number: Any = None
    lost_reason: Any = None
    meta: Any = None
    name: Any = None
    next_follow_up_at: Any = None
    notes: Any = None
    phone: Any = None
    plan: Any = None
    project: Any = None
    project_id: Any = None
    project_name: Any = None
    source: Any = None
    stage_history: Any = None
    status: Any = None
    updated_at: Any = None
    utm: Any = None
    version: Any = None

class LeadsOutPage(_Out):
    items: list[LeadsOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class VisitsOut(_Out):
    _links: Any = None
    assigned_to: Any = None
    assigned_to_name: Any = None
    block: Any = None
    bookings: Any = None
    company_id: Any = None
    count: Any = None
    created_at: Any = None
    created_by: Any = None
    customer: Any = None
    customer_id: Any = None
    date: Any = None
    deleted_at: Any = None
    email: Any = None
    flat: Any = None
    id: Any = None
    is_active: Any = None
    lead_id: Any = None
    meta: Any = None
    name: Any = None
    notes: Any = None
    nudged_on: Any = None
    phone: Any = None
    plan: Any = None
    project: Any = None
    project_id: Any = None
    project_name: Any = None
    slot_end: Any = None
    slot_start: Any = None
    source: Any = None
    status: Any = None
    timeline: Any = None
    updated_at: Any = None
    version: Any = None
    visit_number: Any = None
    visitors_count: Any = None

class VisitsOutPage(_Out):
    items: list[VisitsOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None


class ServiceOut(_Out):
    assigned_to: Any = None
    attachments: Any = None
    block_id: Any = None
    booking_id: Any = None
    booking_number: Any = None
    category: Any = None
    closed_at: Any = None
    company_id: Any = None
    created_at: Any = None
    created_by: Any = None
    customer_id: Any = None
    customer_name: Any = None
    customer_phone: Any = None
    deleted_at: Any = None
    description: Any = None
    flat_number: Any = None
    id: Any = None
    is_active: Any = None
    last_customer_reply_at: Any = None
    priority: Any = None
    project_id: Any = None
    project_name: Any = None
    rating: Any = None
    rating_comment: Any = None
    resolved_at: Any = None
    sla_breached: Any = None
    sla_due_at: Any = None
    stage_history: Any = None
    status: Any = None
    subject: Any = None
    thread: Any = None
    ticket_number: Any = None
    updated_at: Any = None
    version: Any = None
    customer: Any = None
    flat: Any = None
    block: Any = None
    project: Any = None
    plan: Any = None
    bookings: Any = None
    _links: Any = None
    meta: Any = None
    count: Any = None


class ServiceOutPage(_Out):
    items: list[ServiceOut]
    total: Any = None
    page: Any = None
    page_size: Any = None
    next_cursor: Any = None
    total_estimated: bool | None = None
    has_more: Any = None

