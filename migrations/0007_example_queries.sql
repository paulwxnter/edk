-- Example queries: hand-picked requests that show EDK-1 at its best in a demo. Each row holds the exact
-- input to send, so a demo, the landing page or a test can replay it as is.
create table if not exists example_queries (
  id text primary key,
  -- discover | inspect | route | monitor
  operation text not null,
  -- What a person would type, or a short title for calls that take structured input.
  query text not null,
  -- JSON: the request body (or query string, for inspect) to send.
  input text not null,
  -- street imagery | civic | safety | energy | nature | commerce | climate | spatial | ground | navigation | stream
  category text not null,
  -- Discover reasoning to run it at; null for other calls.
  reasoning text,
  -- Why it lands in a demo.
  highlight text not null,
  sort_order integer not null,
  active integer not null default 1,
  created_at integer not null default (unixepoch() * 1000)
);
create index if not exists example_queries_order on example_queries (active, sort_order);

insert or replace into example_queries (id, operation, query, input, category, reasoning, highlight, sort_order) values
('graffiti-sf', 'discover', 'Graffiti in San Francisco', '{"query":"Graffiti in San Francisco","limit":10,"reasoning":"medium","answer":true}', 'street imagery', 'medium', 'Found by sight in street-level imagery and returned with each tag boxed on the photo.', 1),
('damaged-roofs-nola', 'discover', 'Damaged roofs in New Orleans', '{"query":"Damaged roofs in New Orleans","limit":10,"reasoning":"medium","answer":true}', 'street imagery', 'medium', 'Storm damage spotted from imagery, house by house, with the damage outlined.', 2),
('boarded-windows-detroit', 'discover', 'Boarded-up windows in Detroit', '{"query":"Boarded-up windows in Detroit","limit":10,"reasoning":"low","answer":true}', 'street imagery', 'low', 'Vacancy read straight from the street, a signal no listing or registry carries.', 3),
('rodents-restaurants-nyc', 'discover', 'Restaurants cited for rodents in New York City', '{"query":"Restaurants cited for rodent infestations in New York City","limit":10,"answer":true}', 'civic', 'fast', 'Health inspection findings pinned to the door they were written up at.', 4),
('water-main-breaks-chicago', 'discover', 'Water main breaks in Chicago this year', '{"query":"Water main breaks in Chicago this year","limit":10,"answer":true}', 'civic', 'fast', '311 reports filtered in time and place from one plain sentence.', 5),
('ev-charger-permits-austin', 'discover', 'EV charger permits in Austin', '{"query":"Electric vehicle charger permits in Austin","limit":10,"answer":true}', 'civic', 'fast', 'Building permits show where electrification is happening before any map of chargers does.', 6),
('demolitions-brooklyn', 'discover', 'Demolition permits in Brooklyn', '{"query":"Demolition permits in Brooklyn","limit":10,"answer":true}', 'civic', 'fast', 'A neighborhood about to change, read from the paperwork that comes first.', 7),
('hit-and-run-schools-la', 'discover', 'Hit-and-run crashes near schools in Los Angeles', '{"query":"Hit-and-run accidents near schools in Los Angeles","limit":10,"answer":true}', 'safety', 'fast', 'Two datasets joined by distance: crash records measured against every school.', 8),
('alpr-atlanta', 'discover', 'License plate reader cameras in Atlanta', '{"query":"ALPR license plate reader cameras in Atlanta","limit":10,"answer":true}', 'safety', 'fast', 'Surveillance infrastructure most people walk past without seeing.', 9),
('hydrants-schools-boston', 'discover', 'Fire hydrants within 100 meters of a school in Boston', '{"query":"Fire hydrants within 100 meters of a school in Boston","limit":10,"answer":true}', 'spatial', 'fast', 'A radius query in plain English, with the distance measured on every result.', 10),
('starbucks-vs-dunkin-boston', 'discover', 'Starbucks vs. Dunkin'' in Boston', '{"query":"Compare Starbucks and Dunkin'' in Boston","limit":10,"answer":true}', 'commerce', 'fast', 'A rivalry settled by count, store for store, across the city.', 11),
('wind-texas', 'discover', 'Onshore wind turbines in Texas', '{"query":"Onshore wind turbines in Texas","limit":10,"answer":true}', 'energy', 'fast', 'The largest wind fleet in the country, plant by plant, with capacity attached.', 12),
('nuclear-us', 'discover', 'Nuclear power plants in the United States', '{"query":"Nuclear power plants in the United States","limit":10,"answer":true}', 'energy', 'fast', 'A national map of every operating reactor site from a single sentence.', 13),
('flood-houston', 'discover', 'Neighborhoods most exposed to flooding in Houston', '{"query":"Neighborhoods with the deepest hundred-year flood depth in Houston","limit":10,"answer":true}', 'climate', 'fast', 'Modeled flood depth ranked across a city that knows the cost of water.', 14),
('solar-phoenix', 'discover', 'Sunniest neighborhoods for rooftop solar in Phoenix', '{"query":"Neighborhoods with the highest solar potential in Phoenix","limit":10,"answer":true}', 'climate', 'fast', 'Irradiance and panel yield turned into a shortlist of streets.', 15),
('alligators-orlando', 'discover', 'Alligators near Orlando', '{"query":"American alligators near Orlando","limit":10,"reasoning":"low","answer":true}', 'nature', 'low', 'Wildlife sightings with photos, close to theme parks and suburbs.', 16),
('humpbacks-monterey', 'discover', 'Humpback whales in Monterey Bay', '{"query":"Humpback whales in Monterey Bay","limit":10,"reasoning":"low","answer":true}', 'nature', 'low', 'Sightings at sea, each one a photo someone took from a boat.', 17),
('inspect-hoover-dam', 'inspect', 'What lies beneath the Hoover Dam?', '{"lat":36.0160,"lng":-114.7377}', 'ground', null, 'Rock, slope, climate, water and power at one point, read in a single call.', 18),
('route-sf-tahoe', 'route', 'San Francisco to Lake Tahoe with an EV charging stop, avoiding snow', '{"from":"San Francisco, CA","to":"South Lake Tahoe, CA","include":"EV charging station","conditions":"avoid snow","profile":"driving"}', 'navigation', null, 'A mountain drive planned around a charging stop and the weather on the pass.', 19),
('monitor-brooklyn-permits', 'monitor', 'Watch Brooklyn for new building and demolition permits', '{"name":"Brooklyn construction","artifacts":["New Building Permit","Demolition Permit"],"area":"Brooklyn, NY","interval":60}', 'stream', null, 'A standing watch that pings a webhook the moment the neighborhood starts to change.', 20);
