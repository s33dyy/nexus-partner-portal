export type AdvancedFilterOption = {
  label: string;
  value: string;
};

export function filterAdvancedFilterOptions(
  options: readonly AdvancedFilterOption[],
): AdvancedFilterOption[] {
  return options.filter((option) => option.value !== "");
}
