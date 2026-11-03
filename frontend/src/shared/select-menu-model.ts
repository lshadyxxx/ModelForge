export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export function filterSelectOptions(options: SelectOption[], query: string) {
  const needle = query.trim().toLocaleLowerCase('zh-CN');
  if (!needle) return options;
  return options.filter((option) => (
    `${option.label} ${option.description ?? ''}`.toLocaleLowerCase('zh-CN').includes(needle)
  ));
}

export function firstEnabledIndex(options: SelectOption[]) {
  return options.findIndex((option) => !option.disabled);
}

export function nextEnabledIndex(options: SelectOption[], current: number, direction: 1 | -1) {
  if (!options.length) return -1;
  const start = current < 0 ? (direction > 0 ? -1 : 0) : current;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (start + direction * offset + options.length * 2) % options.length;
    if (!options[index].disabled) return index;
  }
  return -1;
}
