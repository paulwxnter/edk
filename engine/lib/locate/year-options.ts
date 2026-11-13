export function getSearchYearOptions() {
  return Array.from({ length: 13 }, (_, index) => String(2014 + index));
}
