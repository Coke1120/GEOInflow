import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, expect, test, vi } from 'vitest';
import { LookupField } from './LookupField';
import { WebsiteValueComboBox } from './WebsiteValueComboBox';

const fixture = vi.hoisted(() => ({ loaded: true }));

vi.mock('@/components/hooks', () => ({
  useMessages: () => ({
    t: (value: string) => value,
    messages: { noResultsFound: 'No results found', noDataAvailable: 'No data' },
  }),
  useWebsiteValuesQuery: ({ type }: { type: string }) => ({
    data: type === 'city' && fixture.loaded ? [{ value: "Xi'an", label: '西安', count: 2 }] : [],
    isLoading: false,
  }),
}));

beforeAll(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
});
afterAll(() => {
  Reflect.deleteProperty(Element.prototype, 'getAnimations');
});
afterEach(() => {
  fixture.loaded = true;
});

test.each(['lookup', 'website'])(
  '%s city options display Chinese and select their raw value',
  async kind => {
    const onChange = vi.fn();
    function Field() {
      const [value, setValue] = useState('');
      const change = (next: string) => {
        setValue(next);
        onChange(next);
      };
      return kind === 'lookup' ? (
        <LookupField websiteId="fixture" type="city" value={value} onChange={change} showClear />
      ) : (
        <WebsiteValueComboBox
          label="City"
          websiteId="fixture"
          type="city"
          value={value}
          startDate={new Date('2026-10-01')}
          endDate={new Date('2026-10-11')}
          onChange={change}
          showClear
        />
      );
    }
    render(<Field />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: '西安' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const option = await screen.findByRole('option', { name: '西安' });
    fireEvent.click(option);
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("Xi'an"));
    expect(input).toHaveValue('西安');
    fireEvent.change(input, { target: { value: 'Xian' } });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith('Xian'));
    expect(input).toHaveValue('Xian');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(await screen.findByRole('option', { name: '西安' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("Xi'an"));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(''));
  },
);

test.each(['lookup', 'website'])('%s displays a saved raw city when its label loads', kind => {
  const onChange = vi.fn();
  const field = (value = "Xi'an") =>
    kind === 'lookup' ? (
      <LookupField websiteId="fixture" type="city" value={value} onChange={onChange} />
    ) : (
      <WebsiteValueComboBox
        label="City"
        websiteId="fixture"
        type="city"
        value={value}
        startDate={new Date('2026-10-01')}
        endDate={new Date('2026-10-11')}
        onChange={onChange}
      />
    );
  fixture.loaded = false;
  const { rerender } = render(field());
  expect(screen.getByRole('combobox')).toHaveValue("Xi'an");
  fixture.loaded = true;
  rerender(field());
  expect(screen.getByRole('combobox')).toHaveValue('西安');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: "Xi'an" } });
  expect(screen.getByRole('combobox')).toHaveValue("Xi'an");
  rerender(field('Jinan'));
  rerender(field());
  expect(screen.getByRole('combobox')).toHaveValue('西安');
});
