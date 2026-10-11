import { type ComboBoxProps, cn, Label, ListItem, Loading, useDebounce } from '@umami/react-zen';
import { useEffect, useMemo, useState } from 'react';
import { ComboBox } from '@/components/common/ComboBox';
import { Empty } from '@/components/common/Empty';
import { useMessages, useWebsiteValuesQuery } from '@/components/hooks';

const DEFAULT_PLACEHOLDER = 'Select an item';

export interface WebsiteValueComboBoxProps
  extends Omit<
    ComboBoxProps,
    'children' | 'inputValue' | 'items' | 'onChange' | 'onInputValueChange'
  > {
  websiteId: string;
  type: string;
  additionalType?: string;
  startDate: Date;
  endDate: Date;
  value: string;
  onChange: (value: string) => void;
}

export function WebsiteValueComboBox({
  websiteId,
  type,
  additionalType = '',
  startDate,
  endDate,
  value,
  onChange,
  label,
  className,
  placeholder = DEFAULT_PLACEHOLDER,
  ...props
}: WebsiteValueComboBoxProps) {
  const { t, messages } = useMessages();
  const [search, setSearch] = useState(value);
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const searchValue = useDebounce(search, 300);
  useEffect(() => {
    if (editingValue !== null && editingValue !== value) setEditingValue(null);
  }, [editingValue, value]);
  const primaryQuery = useWebsiteValuesQuery({
    websiteId,
    type,
    search: searchValue,
    startDate,
    endDate,
  });
  const additionalQuery = useWebsiteValuesQuery({
    websiteId,
    type: additionalType,
    search: searchValue,
    startDate,
    endDate,
  });

  useEffect(() => {
    setSearch('');
    setEditingValue(null);
  }, [type, additionalType]);

  const items = useMemo(() => {
    const rows = [...(primaryQuery.data || []), ...(additionalQuery.data || [])];
    const values = [
      type === 'city' && rows.some(row => row.label === value) ? '' : value,
      ...(primaryQuery.data || []).map(({ value }) => value),
      ...(additionalQuery.data || []).map(({ value }) => value),
    ].filter(Boolean);

    return [...new Set<string>(values)];
  }, [type, value, primaryQuery.data, additionalQuery.data]);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {label && <Label>{label}</Label>}
      <ComboBox
        {...props}
        aria-label={props['aria-label'] ?? label}
        items={
          type === 'city'
            ? items.map(value => ({
                value,
                label:
                  [...(primaryQuery.data || []), ...(additionalQuery.data || [])].find(
                    row => row.value === value,
                  )?.label || value,
              }))
            : items
        }
        filter={type === 'city' ? null : props.filter}
        inputValue={
          type === 'city' && editingValue !== value
            ? [...(primaryQuery.data || []), ...(additionalQuery.data || [])].find(
                row => row.value === value,
              )?.label || value
            : value
        }
        placeholder={placeholder}
        onValueChange={(next, details) => {
          props.onValueChange?.(next, details);
          if (type !== 'city' || !['item-press', 'clear-press'].includes(details.reason)) return;
          setEditingValue(null);
          setSearch(next || '');
          onChange(next || '');
        }}
        onInputValueChange={(value, details) => {
          if (type === 'city' && !['input-change', 'input-clear'].includes(details.reason)) return;
          if (type === 'city') setEditingValue(value);
          setSearch(value);
          onChange(value);
        }}
        renderEmptyState={() =>
          primaryQuery.isLoading || additionalQuery.isLoading ? (
            <Loading placement="center" icon="dots" />
          ) : (
            <Empty message={t(messages.noResultsFound)} />
          )
        }
      >
        {items.map(item => (
          <ListItem key={item} id={item}>
            {[...(primaryQuery.data || []), ...(additionalQuery.data || [])].find(
              row => row.value === item,
            )?.label || item}
          </ListItem>
        ))}
      </ComboBox>
    </div>
  );
}
