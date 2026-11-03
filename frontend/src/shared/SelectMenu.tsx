import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {createPortal} from 'react-dom';
import {
  filterSelectOptions,
  firstEnabledIndex,
  nextEnabledIndex,
  type SelectOption,
} from './select-menu-model';

type Placement = {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
};

function Chevron() {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3.5 6 4.5 4.5L12.5 6"/></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="6.8" cy="6.8" r="4.4"/><path d="m10.2 10.2 3 3"/></svg>;
}

function CheckIcon() {
  return <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 8.3 3.2 3.2L13 4.8"/></svg>;
}

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = '请选择',
  disabled = false,
  required = false,
  searchable = 'auto',
  searchPlaceholder = '搜索选项',
  emptyText = '没有匹配选项',
  size = 'default',
  theme = 'light',
  ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  className = '',
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  searchable?: boolean | 'auto';
  searchPlaceholder?: string;
  emptyText?: string;
  size?: 'default' | 'compact';
  theme?: 'light' | 'dark';
  ariaLabel?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  className?: string;
}) {
  const generatedId = useId().replace(/:/g, '');
  const listboxId = `mf-select-listbox-${generatedId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const selected = options.find((option) => option.value === value);
  const supportsSearch = searchable === 'auto' ? options.length >= 8 : searchable;
  const filtered = useMemo(() => filterSelectOptions(options, query), [options, query]);
  const activeOption = open ? filtered[activeIndex] : undefined;
  const contentMinWidth = useMemo(() => (
    options.some((option) => option.description) || options.some((option) => option.label.length > 14)
      ? 320
      : 240
  ), [options]);

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gutter = 12;
    const gap = 6;
    const availableBelow = window.innerHeight - rect.bottom - gap - gutter;
    const availableAbove = rect.top - gap - gutter;
    const openUp = availableBelow < 260 && availableAbove > availableBelow;
    const width = Math.min(Math.max(rect.width, contentMinWidth), window.innerWidth - gutter * 2);
    const left = Math.min(Math.max(gutter, rect.left), window.innerWidth - width - gutter);
    const available = openUp ? availableAbove : availableBelow;
    const maxHeight = Math.min(390, Math.max(180, available));
    setPlacement({
      left,
      width,
      maxHeight,
      ...(openUp
        ? {bottom: window.innerHeight - rect.top + gap}
        : {top: rect.bottom + gap}),
    });
  }, [contentMinWidth]);

  const closeMenu = useCallback((returnFocus = false) => {
    setOpen(false);
    setQuery('');
    setPlacement(null);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  const openMenu = useCallback((direction: 1 | -1 = 1) => {
    if (disabled) return;
    setQuery('');
    setOpen(true);
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : nextEnabledIndex(options, -1, direction));
  }, [disabled, options, value]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePlacement();
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      closeMenu();
    };
    const handleViewportChange = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      updatePlacement();
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (
        triggerRef.current?.contains(target)
        || popoverRef.current?.contains(target)
        || (target instanceof Element && target.closest('.mf-select__popover'))
      ) return;
      closeMenu();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('focusin', handleFocusIn, true);
    document.addEventListener('scroll', handleViewportChange, true);
    window.addEventListener('resize', handleViewportChange);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('focusin', handleFocusIn, true);
      document.removeEventListener('scroll', handleViewportChange, true);
      window.removeEventListener('resize', handleViewportChange);
    };
  }, [closeMenu, open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    const nextIndex = filtered.findIndex((option) => option.value === value && !option.disabled);
    setActiveIndex(nextIndex >= 0 ? nextIndex : firstEnabledIndex(filtered));
  }, [filtered, open, value]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const option = listRef.current?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`);
    option?.scrollIntoView({block: 'nearest'});
  }, [activeIndex, open]);

  function selectOption(option: SelectOption | undefined) {
    if (!option || option.disabled) return;
    onChange(option.value);
    closeMenu(true);
  }

  function moveActive(direction: 1 | -1) {
    setActiveIndex((current) => nextEnabledIndex(filtered, current, direction));
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (!open) openMenu(direction);
      else moveActive(direction);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) openMenu(1);
      else selectOption(activeOption);
    }
  }

  function handlePopoverKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      selectOption(activeOption);
    }
  }

  return <div className={`mf-select mf-select--${size}${theme === 'dark' ? ' mf-select--dark' : ''} ${className}`.trim()}>
    <button
      ref={triggerRef}
      type="button"
      className="mf-select__trigger"
      role={supportsSearch ? 'button' : 'combobox'}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={listboxId}
      aria-activedescendant={!supportsSearch && open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid || undefined}
      aria-describedby={ariaDescribedBy}
      aria-required={required || undefined}
      disabled={disabled}
      title={selected?.label ?? placeholder}
      onClick={() => open ? closeMenu() : openMenu()}
      onKeyDown={handleTriggerKeyDown}
    >
      <span className={`mf-select__value${selected ? '' : ' is-placeholder'}`}>{selected?.label ?? placeholder}</span>
      <span className="mf-select__chevron" aria-hidden="true"><Chevron/></span>
    </button>
    {open && placement && createPortal(
      <div
        ref={popoverRef}
        className={`mf-select__popover${theme === 'dark' ? ' mf-select--dark' : ''}`}
        style={{
          left: placement.left,
          width: placement.width,
          maxHeight: placement.maxHeight,
          ...(placement.top === undefined ? {} : {top: placement.top}),
          ...(placement.bottom === undefined ? {} : {bottom: placement.bottom}),
        }}
        onKeyDown={handlePopoverKeyDown}
      >
        {supportsSearch && <label className="mf-select__search">
          <SearchIcon/>
          <span className="mf-select__sr-only">{searchPlaceholder}</span>
          <input
            ref={searchRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            aria-label={searchPlaceholder}
            value={query}
            autoFocus
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(firstEnabledIndex(filterSelectOptions(options, event.target.value)));
            }}
            placeholder={searchPlaceholder}
          />
        </label>}
        <div ref={listRef} id={listboxId} className="mf-select__list" role="listbox" aria-label={ariaLabel ?? placeholder}>
          {filtered.length ? filtered.map((option, index) => {
            const isSelected = option.value === value;
            return <div
              key={option.value}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={isSelected}
              aria-disabled={option.disabled || undefined}
              className={`mf-select__option${index === activeIndex ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${option.disabled ? ' is-disabled' : ''}`}
              data-option-index={index}
              title={option.description ? `${option.label} · ${option.description}` : option.label}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => {
                if (!option.disabled && index !== activeIndex) setActiveIndex(index);
              }}
              onClick={() => selectOption(option)}
            >
              <span className="mf-select__check">{isSelected ? <CheckIcon/> : null}</span>
              <span className="mf-select__option-copy">
                <strong>{option.label}</strong>
                {option.description && <small>{option.description}</small>}
              </span>
            </div>;
          }) : <div className="mf-select__empty">{emptyText}</div>}
        </div>
        {supportsSearch && <div className="mf-select__count">{filtered.length} / {options.length} 个选项</div>}
      </div>,
      document.body,
    )}
  </div>;
}
