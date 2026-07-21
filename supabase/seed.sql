insert into public.portal_demo_metrics (id, label, value, hint, tone, sort_order, is_seed)
values
  ('a0000000-0000-4000-8000-000000000001', 'Period revenue', '$148.2K', 'Up 18% vs last month', 'primary', 1, true),
  ('a0000000-0000-4000-8000-000000000002', 'Deals registered', '24', '7 strategic, 17 standard', 'default', 2, true),
  ('a0000000-0000-4000-8000-000000000003', 'Win rate', '67%', '16 wins from 24 deals', 'success', 3, true),
  ('a0000000-0000-4000-8000-000000000004', 'Pipeline value', '$1.9M', '11 open opportunities', 'warning', 4, true),
  ('a0000000-0000-4000-8000-000000000005', 'Avg. deal size', '$18.4K', 'Healthy mid-market mix', 'default', 5, true),
  ('a0000000-0000-4000-8000-000000000006', 'Current tier mix', 'Gold', '3 partners are ready for Platinum', 'primary', 6, true)
on conflict (id) do update
set label = excluded.label,
    value = excluded.value,
    hint = excluded.hint,
    tone = excluded.tone,
    sort_order = excluded.sort_order,
    is_seed = excluded.is_seed;

insert into public.portal_demo_feed_items (id, title, body, time_label, tone, sort_order, is_seed)
values
  ('b0000000-0000-4000-8000-000000000001', 'Upgrade your video presence instantly', 'LIVEY WC350 QHD Webcam - stunning 2K clarity, auto focus, low-light enhancement, dual mics, built-in privacy shutter, and a 360° swivel clip. Perfect for meetings and calls.', 'Just now', 'primary', 1, true),
  ('b0000000-0000-4000-8000-000000000002', 'ACME Infra deal approved', 'The $4,800 standard deal for ACME Infra has cleared partner review and is now waiting on LIVEY approval.', '14 min ago', 'success', 2, true),
  ('b0000000-0000-4000-8000-000000000003', 'Tier milestone reached', 'North Star Systems crossed the Silver threshold after closing two deals this quarter. Margin benefits have been unlocked.', '1 hr ago', 'warning', 3, true),
  ('b0000000-0000-4000-8000-000000000004', 'Client lock reserved', 'PartnerShield reserved Metro Health for a strategic opportunity. Discovery is now exclusively protected for 14 days.', 'Today', 'info', 4, true)
on conflict (id) do update
set title = excluded.title,
    body = excluded.body,
    time_label = excluded.time_label,
    tone = excluded.tone,
    sort_order = excluded.sort_order,
    is_seed = excluded.is_seed;

insert into public.portal_demo_partner_spotlights (id, company_name, contact_name, region, tier, pipeline_value, last_activity, status, sort_order, is_seed)
values
  ('c0000000-0000-4000-8000-000000000001', 'PartnerShield Technologies', 'Amit Verma', 'India West', 'Gold', '$420K', 'Moved to proposal', 'Approved', 1, true),
  ('c0000000-0000-4000-8000-000000000002', 'North Star Systems', 'Priya Nair', 'South India', 'Silver', '$185K', 'Awaiting demo feedback', 'Under review', 2, true),
  ('c0000000-0000-4000-8000-000000000003', 'Quantum Mesh Solutions', 'Rohit Kulkarni', 'North India', 'Platinum', '$760K', 'Won a strategic RFQ', 'Won', 3, true),
  ('c0000000-0000-4000-8000-000000000004', 'BluePeak Integrators', 'Sneha Iyer', 'West India', 'Registered', '$64K', 'Submitted docs', 'Submitted', 4, true)
on conflict (id) do update
set company_name = excluded.company_name,
    contact_name = excluded.contact_name,
    region = excluded.region,
    tier = excluded.tier,
    pipeline_value = excluded.pipeline_value,
    last_activity = excluded.last_activity,
    status = excluded.status,
    sort_order = excluded.sort_order,
    is_seed = excluded.is_seed;
