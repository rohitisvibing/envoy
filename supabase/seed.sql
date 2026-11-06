-- Default principal for the single-user MVP, with mixed disclosure policies.
insert into principals (id, preferred_languages, communication_preferences, background)
values ('00000000-0000-0000-0000-000000000001', '{English,Kannada}',
        'Prefers concise, respectful conversations.',
        'Has rented the current apartment in Indiranagar for two years and always paid on time.')
on conflict (id) do nothing;

insert into profile_fields (principal_id, key, label, value, disclosure, is_custom, position) values
  ('00000000-0000-0000-0000-000000000001', 'full_name', 'Full name', 'Ananya Iyer', 'always', false, 0),
  ('00000000-0000-0000-0000-000000000001', 'preferred_name', 'Preferred name', 'Ananya', 'always', false, 1),
  ('00000000-0000-0000-0000-000000000001', 'occupation', 'Occupation', 'Software engineer', 'relevant', false, 2),
  ('00000000-0000-0000-0000-000000000001', 'company', 'Company', null, 'relevant', false, 3),
  ('00000000-0000-0000-0000-000000000001', 'city', 'Current city', 'Bengaluru', 'relevant', false, 4),
  ('00000000-0000-0000-0000-000000000001', 'phone', 'Phone number', null, 'approval', false, 5),
  ('00000000-0000-0000-0000-000000000001', 'email', 'Email', null, 'approval', false, 6),
  ('00000000-0000-0000-0000-000000000001', 'salary', 'Salary', null, 'never', false, 7)
on conflict (principal_id, key) do nothing;

insert into agent_templates (id, name, description, agent_type, prompt_example) values
  ('5c1d6a1e-0000-4000-8000-000000000001', 'Rent negotiator',
   'Negotiate monthly rent, deposit or lease terms with a landlord.', 'Negotiator',
   'Negotiate my apartment rent from ₹35,000 to ₹30,000. The landlord is asking for ₹35,000. I want a 12-month agreement. Be polite but firm. Speak in Kannada if the landlord prefers Kannada. Do not agree to anything above ₹32,000 without asking me.'),
  ('5c1d6a1e-0000-4000-8000-000000000002', 'Subscription cancellation',
   'Cancel a service and ask for a refund of unused days.', 'Customer support',
   'Call my broadband provider''s support line and cancel my plan from the end of this month. Ask for a refund for unused days. Don''t accept a retention offer unless it brings the bill under ₹500 a month, and check with me first.'),
  ('5c1d6a1e-0000-4000-8000-000000000003', 'Appointment booking',
   'Book or reschedule an appointment within your availability.', 'Scheduler',
   'Book a dental cleaning for me next week, weekday evenings after 6pm only. Speak Hindi or English. Don''t share my phone number unless they insist, ask me first.')
on conflict (id) do nothing;
