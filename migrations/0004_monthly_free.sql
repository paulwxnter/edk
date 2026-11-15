-- Free CU are granted every calendar month instead of once. free_units is what is left of this month's
-- grant; free_month is the month (UTC start, ms) it was granted for. `units` now holds credits only.
alter table balances add column free_units integer not null default 0;
alter table balances add column free_month integer not null default 0;
